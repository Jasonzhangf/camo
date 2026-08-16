import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

export const PROFILE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

function resolveHomeDir() {
  const envHome = process.platform === 'win32'
    ? String(process.env.USERPROFILE || '').trim()
    : String(process.env.HOME || '').trim();
  return envHome || os.homedir();
}

function resolveDataRoot() {
  const portableRoot = String(process.env.CAMO_PORTABLE_ROOT || process.env.CAMO_ROOT || '').trim();
  if (portableRoot) return path.join(portableRoot, '.camo');
  return path.join(resolveHomeDir(), '.camo');
}

export function resolveProfilesRoot() {
  const documentedRoot = String(process.env.CAMO_PROFILE_ROOT || '').trim();
  const legacyRoot = String(process.env.CAMO_PATHS_PROFILES || '').trim();
  if (documentedRoot && legacyRoot && path.resolve(documentedRoot) !== path.resolve(legacyRoot)) {
    throw new CamoError({
      code: 'E_STATE_INVALID',
      details: { resource: 'profile_root', reason: 'CAMO_PROFILE_ROOT and CAMO_PATHS_PROFILES disagree' },
    });
  }
  const envRoot = documentedRoot || legacyRoot;
  if (envRoot) return path.resolve(envRoot);
  return path.join(resolveDataRoot(), 'profiles');
}

export function resolveProfileDir(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return path.join(resolveProfilesRoot(), id);
}

export function resolveFingerprintPath(profileId) {
  return path.join(resolveProfileDir(profileId), 'fingerprint.json');
}

export function resolveCookieBackupDir(profileId = null) {
  const id = String(profileId || '').trim();
  if (!id) return path.join(resolveDataRoot(), 'cookies');
  return path.join(resolveProfileDir(id), 'cookie-backups');
}

export function resolveEphemeralTempDirName(pid, ts = Date.now()) {
  return `_temp_${pid}_${ts}`;
}

function resolveLegacyFingerprintPath(profileId) {
  return path.join(resolveDataRoot(), 'fingerprints', `${profileId}.json`);
}

function resolveLegacyCookieDir(profileId) {
  return path.join(resolveDataRoot(), 'cookies', profileId);
}

// Migrate legacy per-profile state (pre profile-owned storage paths) into the
// profile-owned storage root. Netscape backups and visit metadata move to
// cookie-backups; BrowserInstance JSON backups stay directly under the
// profile root where that runtime reads them. One-shot, fail-fast: if any
// target exists the operation throws E_STATE_DUPLICATE and leaves source and
// target state untouched. Global `~/.camo/cookies/<domain>.txt` is not moved
// because it has no profile owner.
export function migrateLegacyProfileData(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id, reason: 'must match [a-zA-Z0-9._-]+' } });
  }

  const legacyFingerprint = resolveLegacyFingerprintPath(id);
  const legacyCookieDir = resolveLegacyCookieDir(id);
  const legacyPaths = [];
  if (fs.existsSync(legacyFingerprint)) legacyPaths.push(legacyFingerprint);

  const targetFingerprint = resolveFingerprintPath(id);
  const targetCookieDir = resolveCookieBackupDir(id);

  if (legacyPaths.length === 0 && !fs.existsSync(legacyCookieDir)) {
    return { migrated: false, profileId: id, legacyPaths: [], target: null };
  }

  if (fs.existsSync(legacyFingerprint) && fs.existsSync(targetFingerprint)) {
    throw new CamoError({
      code: 'E_STATE_DUPLICATE',
      details: { resource: 'profile_fingerprint', profileId: id, legacy: legacyFingerprint, target: targetFingerprint },
    });
  }

  const cookieMoves = [];
  if (fs.existsSync(legacyCookieDir)) {
    for (const entry of fs.readdirSync(legacyCookieDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        throw new CamoError({
          code: 'E_STATE_INVALID',
          details: {
            resource: 'profile_cookie_backup',
            profileId: id,
            legacy: path.join(legacyCookieDir, entry.name),
            reason: 'legacy cookie profile directory must contain files only',
          },
        });
      }
      const from = path.join(legacyCookieDir, entry.name);
      const isBrowserInstanceJson = entry.name.endsWith('.json') && entry.name !== '.lastVisit.json';
      const to = isBrowserInstanceJson
        ? path.join(resolveProfileDir(id), entry.name)
        : path.join(targetCookieDir, entry.name);
      if (fs.existsSync(to)) {
        // Refuse to clobber a same-named backup. Abort the whole migration
        // and leave legacy files in place so an operator can resolve the
        // conflict explicitly.
        throw new CamoError({
          code: 'E_STATE_DUPLICATE',
          details: { resource: 'profile_cookie_backup', profileId: id, legacy: from, target: to },
        });
      }
      cookieMoves.push({ kind: 'cookie', from, to });
    }
  }

  const movePlan = [
    ...(fs.existsSync(legacyFingerprint)
      ? [{ kind: 'fingerprint', from: legacyFingerprint, to: targetFingerprint }]
      : []),
    ...cookieMoves,
  ];
  const moved = [];
  try {
    for (const item of movePlan) {
      fs.mkdirSync(path.dirname(item.to), { recursive: true });
      fs.copyFileSync(item.from, item.to, fs.constants.COPYFILE_EXCL);
      moved.push(item);
      fs.unlinkSync(item.from);
    }
    if (fs.existsSync(legacyCookieDir) && fs.readdirSync(legacyCookieDir).length === 0) {
      fs.rmdirSync(legacyCookieDir);
    }
  } catch (cause) {
    const rollbackFailures = [];
    for (const item of moved.reverse()) {
      if (!fs.existsSync(item.to)) continue;
      try {
        if (fs.existsSync(item.from)) {
          fs.unlinkSync(item.to);
          continue;
        }
        fs.mkdirSync(path.dirname(item.from), { recursive: true });
        fs.copyFileSync(item.to, item.from, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(item.to);
      }
      catch (rollbackCause) {
        rollbackFailures.push({ from: item.to, to: item.from, error: rollbackCause?.message || String(rollbackCause) });
      }
    }
    throw new CamoError({
      code: 'E_IO_FILESYSTEM',
      details: { op: 'migrate legacy profile data', profileId: id, rollbackFailures },
      cause,
    });
  }

  return {
    migrated: true,
    profileId: id,
    legacy: legacyFingerprint,
    target: targetFingerprint,
    moved,
    legacyPaths,
  };
}
