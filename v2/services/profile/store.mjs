// Profile store. Single truth_owner for resource_id=profile.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const PROFILE_FILE = 'camo-profile.json';
let _overrideRoot = null;
let _overrideLock = false;

export function __setProfilesRootForTest(p) {
  if (_overrideLock) {
    // Allow only from test scope; double-locking prevents accidental misuse.
    _overrideRoot = p;
    return;
  }
  throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setProfilesRootForTest', reason: 'call __enableTestRoot() first' } });
}

export function __enableTestRoot() {
  _overrideLock = true;
}

function profilesRoot() {
  if (_overrideRoot) return _overrideRoot;
  const home = os.homedir();
  if (process.platform === 'win32') {
    const hasD = (() => { try { return fs.existsSync('D:\\'); } catch { return false; } })();
    return hasD ? path.join('D:\\', 'camo', 'profiles') : path.join(home, '.camo', 'profiles');
  }
  const envOverride = (process.env.CAMO_PROFILE_ROOT || process.env.CAMO_PATHS_PROFILES || '').trim();
  if (envOverride) return path.resolve(envOverride);
  return path.join(home, '.camo', 'profiles');
}

function profileDirFor(profileId) {
  const id = String(profileId || '').trim();
  if (!id) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return path.join(profilesRoot(), id);
}

function profileFileFor(profileId) {
  return path.join(profileDirFor(profileId), PROFILE_FILE);
}

function nowIso() { return new Date().toISOString(); }

function writeAtomic(file, payload) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function defaultProfileMeta() {
  return {
    fingerprint: null,
    windowSize: null,
    headless: false,
    idleTimeoutMs: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function read(profileId) {
  const file = profileFileFor(profileId);
  if (!fs.existsSync(file)) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'profile', profileId, path: file } });
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'read', path: file }, cause });
  }
  if (!raw || raw.profileId !== profileId) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'read', reason: 'profileId mismatch', path: file, expected: profileId, actual: raw?.profileId ?? null } });
  }
  return raw;
}

export function exists(profileId) {
  if (_overrideRoot) {
    return fs.existsSync(path.join(_overrideRoot, String(profileId || '').trim(), PROFILE_FILE));
  }
  try { read(profileId); return true; } catch (e) { if (e instanceof CamoError && e.code === 'E_STATE_NOT_FOUND') return false; throw e; }
}

export function list() {
  const root = profilesRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, PROFILE_FILE)))
    .map((d) => d.name)
    .sort();
}

export function write(profileId, patch = {}) {
  const file = profileFileFor(profileId);
  let next;
  try {
    const prev = exists(profileId) ? read(profileId) : { profileId, ...defaultProfileMeta() };
    next = {
      ...prev,
      ...patch,
      profileId,
      createdAt: prev.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
  } catch (cause) { throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'compose' }, cause }); }
  try { writeAtomic(file, next); } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'write', path: file }, cause });
  }
  return next;
}

export function deleteProfile(profileId) {
  const dir = profileDirFor(profileId);
  if (!fs.existsSync(dir)) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'profile', profileId, path: dir } });
  }
  try { fs.rmSync(dir, { recursive: true, force: false }); } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'delete', path: dir }, cause });
  }
}
