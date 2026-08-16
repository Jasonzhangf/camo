import os from 'node:os';
import path from 'node:path';

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
  const envRoot = String(process.env.CAMO_PATHS_PROFILES || '').trim();
  if (envRoot) return path.resolve(envRoot);
  return path.join(resolveDataRoot(), 'profiles');
}

export function resolveProfileDir(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new Error('resolveProfileDir: empty profileId');
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new Error(`resolveProfileDir: invalid profileId "${id}"`);
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
