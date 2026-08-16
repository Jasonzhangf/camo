// Profile lock manager. Single truth_owner for resource_id=profile_lock.
//
// Storage: ~/.camo/profiles/<profile_id>/lock.json
// File contents: { pid, owner, profileId, acquiredAt, mode, processIdentity }
// mode is "F" (friendly = reject live holder) or "F|" (force = terminate live holder).
//
// Hard guards:
//   - Only this module writes the lock file.
//   - SIGTERM and SIGKILL of previous holder only happens when mode=="F|".
//   - Acquire re-entrant on same pid is a no-op (return same record).
//   - Release only succeeds for the current owner pid.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { getProcessIdentity, isProcessAlive } from '../daemon_registration/registry.mjs';
import { PROFILE_ID_PATTERN, resolveProfilesRoot } from '../profile/storage_paths.mjs';

const LOCK_FILE = 'lock.json';
const SELF_ONLY_IDENTITY_PREFIX = 'fallback:';
let _overrideRoot = null;
let _enabledTest = false;
let _selfIdentity = null;
export function __enableTestRoot() { _enabledTest = true; _overrideRoot = null; }
export function __setLocksRootForTest(p) {
  if (!_enabledTest) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setLocksRootForTest' } });
  _overrideRoot = p;
}

function locksRoot() {
  if (_overrideRoot) return _overrideRoot;
  const envOverride = (process.env.CAMO_LOCK_ROOT || process.env.CAMO_PATHS_LOCKS || '').trim();
  if (envOverride) return path.resolve(envOverride);
  return resolveProfilesRoot();
}

function lockFile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return path.join(locksRoot(), id, LOCK_FILE);
}

function selfGenerationIdentity() {
  if (_selfIdentity !== null) return _selfIdentity;
  try {
    const identity = getProcessIdentity(process.pid);
    if (typeof identity !== 'string' || identity.length === 0) throw new Error('process identity is empty');
    _selfIdentity = identity;
  } catch {
    _selfIdentity = `${SELF_ONLY_IDENTITY_PREFIX}${process.pid}:${randomUUID()}`;
  }
  return _selfIdentity;
}

function processIdentity(pid) {
  if (pid === process.pid) return selfGenerationIdentity();
  if (!isProcessAlive(pid)) return null;
  return getProcessIdentity(pid);
}

function lockChanged(profileId, reason, cause) {
  return new CamoError({
    code: 'E_STATE_LOCKED',
    details: { resource: 'profile_lock', profileId, reason },
    cause,
  });
}

function withProfileMutex(profileId, operation) {
  const file = lockFile(profileId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let releaseMutex;
  try {
    releaseMutex = lockfile.lockSync(file, {
      realpath: false,
      stale: 10_000,
      update: 5_000,
    });
  } catch (cause) {
    if (cause?.code === 'ELOCKED') {
      throw lockChanged(profileId, 'profile lock mutation already in progress', cause);
    }
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'lock mutex', path: file }, cause });
  }
  try {
    return operation(file);
  } finally {
    releaseMutex();
  }
}

function killProcess(pid, graceMs = 5000) {
  const p = Number(pid);
  if (!Number.isFinite(p) || p <= 0) return false;
  try { process.kill(p, 'SIGTERM'); } catch {}
  const start = Date.now();
  while (Date.now() - start < graceMs) {
    if (!isProcessAlive(p)) return true;
  }
  try { process.kill(p, 'SIGKILL'); } catch {}
  return !isProcessAlive(p);
}

function nowIso() { return new Date().toISOString(); }

function writeExclusive(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', flag: 'wx' });
}

function readLock(profileId) {
  const file = lockFile(profileId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return { file, raw, text: fs.readFileSync(file, 'utf8') };
  } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'read', path: file }, cause });
  }
}

function normalizeMode(mode) {
  const m = String(mode || '').trim();
  if (m === '' || m === 'F') return 'F';
  if (m === 'F|') return 'F|';
  throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'mode', value: mode, allowed: ['F', 'F|'] } });
}

export function probe(profileId) {
  const r = readLock(profileId);
  if (!r) return { profileId, held: false };
  const { raw } = r;
  const alive = isProcessAlive(raw.pid);
  return {
    profileId,
    held: alive,
    raw: alive ? raw : null,
    stale: !alive,
  };
}

export function read(profileId) {
  const r = readLock(profileId);
  if (!r) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'profile_lock', profileId } });
  }
  return r.raw;
}

function acquireLocked(profileId, file, opts) {
  const mode = normalizeMode(opts.mode || 'F');
  const owner = String(opts.owner || 'browser-service');
  const pid = Number.isFinite(opts.pid) ? opts.pid : process.pid;
  const nextIdentity = processIdentity(pid);
  const existing = readLock(profileId);
  if (existing) {
    const cur = existing.raw;
    const sameOwner = cur.pid === pid && cur.owner === owner;
    if (sameOwner && cur.processIdentity === nextIdentity) return cur;
    const alive = isProcessAlive(cur.pid);
    if (alive) {
      const recordedIdentity = typeof cur.processIdentity === 'string' ? cur.processIdentity : null;
      let liveIdentity = null;
      if (recordedIdentity && !recordedIdentity.startsWith(SELF_ONLY_IDENTITY_PREFIX)) {
        try { liveIdentity = getProcessIdentity(cur.pid); } catch {}
      }
      const sameGeneration = recordedIdentity == null
        || recordedIdentity.startsWith(SELF_ONLY_IDENTITY_PREFIX)
        || liveIdentity == null
        || liveIdentity === recordedIdentity;
      if (sameGeneration && mode !== 'F|') {
        throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, holder: { pid: cur.pid, owner: cur.owner } } });
      }
      if (sameGeneration && mode === 'F|' && !killProcess(cur.pid, opts.graceMs ?? 5000)) {
        throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, reason: 'holder survived force acquire', holder: { pid: cur.pid, owner: cur.owner } } });
      }
    }
    try {
      if (fs.readFileSync(file, 'utf8') !== existing.text) {
        throw lockChanged(profileId, 'lock changed during acquire');
      }
      fs.unlinkSync(file);
    } catch (cause) {
      if (cause instanceof CamoError) throw cause;
      if (cause?.code === 'ENOENT') throw lockChanged(profileId, 'lock changed during acquire', cause);
      throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'replace stale lock', path: file }, cause });
    }
  }
  const next = { pid, owner, profileId, acquiredAt: nowIso(), mode, processIdentity: nextIdentity };
  try {
    writeExclusive(file, next);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, reason: 'lock acquired concurrently' }, cause });
    }
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'acquire', path: file }, cause });
  }
  return next;
}

export function acquire(profileId, opts = {}) {
  return withProfileMutex(profileId, (file) => acquireLocked(profileId, file, opts));
}

export function forceAcquire(profileId, opts = {}) {
  return acquire(profileId, { ...opts, mode: 'F|' });
}

export function release(profileId, opts = {}) {
  return withProfileMutex(profileId, () => {
    const r = readLock(profileId);
    if (!r) return false;
    const cur = r.raw;
    const pid = Number.isFinite(opts.pid) ? opts.pid : process.pid;
    const owner = String(opts.owner || 'browser-service');
    if (cur.pid !== pid || cur.owner !== owner) {
      throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, reason: 'caller is not the current holder', holder: { pid: cur.pid, owner: cur.owner } } });
    }
    if (cur.processIdentity !== processIdentity(pid)) {
      throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, reason: 'caller process generation does not own lock' } });
    }
    try { fs.unlinkSync(r.file); } catch (cause) {
      throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'release', path: r.file }, cause });
    }
    return true;
  });
}

function isLegalProfileDirName(name) {
  return typeof name === 'string' && PROFILE_ID_PATTERN.test(name);
}

export function cleanupStale() {
  const root = locksRoot();
  if (!fs.existsSync(root)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isLegalProfileDirName(entry.name)) continue;
    const profileId = entry.name;
    withProfileMutex(profileId, () => {
      const probeOut = probe(profileId);
      if (!probeOut.stale) return;
      const stale = readLock(profileId);
      if (stale) fs.unlinkSync(stale.file);
      removed.push(profileId);
    });
  }
  return removed;
}

export function listHeld() {
  const root = locksRoot();
  if (!fs.existsSync(root)) return [];
  const held = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isLegalProfileDirName(entry.name)) continue;
    const profileId = entry.name;
    const p = probe(profileId);
    if (p.held) held.push(profileId);
  }
  return held.sort();
}
