// Profile lock manager. Single truth_owner for resource_id=profile_lock.
//
// Storage: ~/.camo/locks/<profile_id>.lock
// File contents: { pid, owner, profileId, acquiredAt, mode }
// mode is "F" (friendly = no SIGKILL of previous holder) or "F|" (force = SIGKILL).
//
// Hard guards:
//   - Only this module writes the lock file.
//   - SIGTERM and SIGKILL of previous holder only happens when mode=="F|".
//   - Acquire re-entrant on same pid is a no-op (return same record).
//   - Release only succeeds for the current owner pid.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const LOCK_FILE = 'lock.json';
let _overrideRoot = null;
let _enabledTest = false;
export function __enableTestRoot() { _enabledTest = true; _overrideRoot = null; }
export function __setLocksRootForTest(p) {
  if (!_enabledTest) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setLocksRootForTest' } });
  _overrideRoot = p;
}

function locksRoot() {
  if (_overrideRoot) return _overrideRoot;
  const home = os.homedir();
  if (process.platform === 'win32') {
    const hasD = (() => { try { return fs.existsSync('D:\\'); } catch { return false; } })();
    return hasD ? path.join('D:\\', 'camo', 'locks') : path.join(home, '.camo', 'locks');
  }
  const envOverride = (process.env.CAMO_LOCK_ROOT || process.env.CAMO_PATHS_LOCKS || '').trim();
  if (envOverride) return path.resolve(envOverride);
  return path.join(home, '.camo', 'locks');
}

function lockFile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return path.join(locksRoot(), `${id}.lock.json`);
}

function isProcessAlive(pid) {
  const p = Number(pid);
  if (!Number.isFinite(p) || p <= 0) return false;
  try { process.kill(p, 0); return true; } catch { return false; }
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

function writeAtomic(file, payload) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readLock(profileId) {
  const file = lockFile(profileId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return { file, raw };
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

export function acquire(profileId, opts = {}) {
  const file = lockFile(profileId);
  const mode = normalizeMode(opts.mode || 'F');
  const owner = String(opts.owner || 'browser-service');
  const pid = Number.isFinite(opts.pid) ? opts.pid : process.pid;
  const existing = readLock(profileId);
  if (existing) {
    const cur = existing.raw;
    const sameOwner = cur.pid === pid && cur.owner === owner;
    if (sameOwner) return cur;
    const alive = isProcessAlive(cur.pid);
    if (alive && mode !== 'F|') {
      throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, holder: { pid: cur.pid, owner: cur.owner } } });
    }
    if (alive && mode === 'F|') {
      killProcess(cur.pid, opts.graceMs ?? 5000);
    }
  }
  const next = { pid, owner, profileId, acquiredAt: nowIso(), mode };
  writeAtomic(file, next);
  return next;
}

export function forceAcquire(profileId, opts = {}) {
  return acquire(profileId, { ...opts, mode: 'F|' });
}

export function release(profileId, opts = {}) {
  const r = readLock(profileId);
  if (!r) return false;
  const cur = r.raw;
  const pid = Number.isFinite(opts.pid) ? opts.pid : process.pid;
  const owner = String(opts.owner || 'browser-service');
  if (cur.pid !== pid || cur.owner !== owner) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile_lock', profileId, reason: 'caller is not the current holder', holder: { pid: cur.pid, owner: cur.owner } } });
  }
  try { fs.unlinkSync(r.file); } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'release', path: r.file }, cause });
  }
  return true;
}

export function cleanupStale() {
  const root = locksRoot();
  if (!fs.existsSync(root)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(root)) {
    if (!entry.endsWith('.lock.json')) continue;
    const profileId = entry.slice(0, -('.lock.json'.length));
    const probeOut = probe(profileId);
    if (probeOut.stale) {
      try {
        fs.unlinkSync(path.join(root, entry));
        removed.push(profileId);
      } catch {}
    }
  }
  return removed;
}

export function listHeld() {
  const root = locksRoot();
  if (!fs.existsSync(root)) return [];
  const held = [];
  for (const entry of fs.readdirSync(root)) {
    if (!entry.endsWith('.lock.json')) continue;
    const profileId = entry.slice(0, -('.lock.json'.length));
    const p = probe(profileId);
    if (p.held) held.push(profileId);
  }
  return held.sort();
}
