// Browser session manager. Single truth_owner for browser_session and
// browser_target.
//
// In-process Map of profileId -> session. The CLI process only ever
// reads through `read`/`list`. Writes (create/delete/markClosed) are
// only invoked from inside the browser-service process boundary.
//
// Hard guards:
//   - No fallback to v1 session-registry.
//   - Every entry carries status (active|reconnecting|closed) and a
//     monotonic updatedAt to prevent split-brain with WS consumers.
//   - On process exit the registry is gone (camo uses disk projection
//     in `disk.mjs` for recovery; not loaded here).

import crypto from 'node:crypto';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const ALLOWED_STATUS = new Set(['active', 'reconnecting', 'closed']);
const MAX_LIFECYCLE_EVENTS = 4096;

const _state = new Map();     // profileId -> session
const _lifecycle = [];        // append-only event list (read-only access for tools)
const _targets = new Map();   // targetId -> target

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    // In production this manager is only writable from inside the
    // browser-service bootstrap. Tests opt in via __enableTestRoot.
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'session.write', reason: 'manager not in writable scope' } });
  }
}

function nowIso() { return new Date().toISOString(); }

function genInstanceId() {
  return `inst_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function genTargetId() {
  return `t_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function pushLifecycle(event) {
  _lifecycle.push(event);
  if (_lifecycle.length > MAX_LIFECYCLE_EVENTS) {
    _lifecycle.splice(0, _lifecycle.length - MAX_LIFECYCLE_EVENTS);
  }
}

function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!ALLOWED_STATUS.has(v)) throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'status', value: s } });
  return v;
}

function normalizeAlias(a) {
  const text = String(a || '').trim();
  if (!text) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(text)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'alias', value: text, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return text.slice(0, 64);
}

export function create(profileId, info = {}) {
  ensureWritable();
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (_state.has(id)) {
    throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'browser_session', profileId: id } });
  }
  const now = nowIso();
  const alias = normalizeAlias(info.alias);
  if (alias) {
    for (const [, s] of _state) {
      if (s.alias === alias) {
        throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'alias', alias } });
      }
    }
  }
  const record = {
    profileId: id,
    instanceId: String(info.instanceId || genInstanceId()),
    generation: Number.isInteger(info.generation) && info.generation >= 0
      ? info.generation
      : 0,
    alias,
    headless: info.headless === true,
    startedAt: now,
    updatedAt: now,
    status: normalizeStatus(info.status || 'active'),
    ownerPid: Number.isFinite(info.ownerPid) ? info.ownerPid : process.pid,
    metadata: info.metadata && typeof info.metadata === 'object' ? info.metadata : {},
  };
  _state.set(id, record);
  pushLifecycle({ kind: 'create', profileId: id, at: now, alias });
  return record;
}

export function read(profileId) {
  const id = String(profileId || '').trim();
  if (!_state.has(id)) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_session', profileId: id } });
  }
  return _state.get(id);
}

export function tryRead(profileId) {
  const id = String(profileId || '').trim();
  return _state.get(id) || null;
}

export function touch(profileId) {
  ensureWritable();
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  const cur = _state.get(id);
  if (!cur) return null;
  cur.updatedAt = nowIso();
  pushLifecycle({ kind: 'touch', profileId: id, at: cur.updatedAt });
  return cur;
}

export function list() {
  return [..._state.values()].sort((a, b) => a.startedAt < b.startedAt ? -1 : 1);
}

export function update(profileId, patch = {}) {
  ensureWritable();
  const cur = read(profileId);
  const next = {
    ...cur,
    ...patch,
    profileId: cur.profileId,
    instanceId: cur.instanceId,
    updatedAt: nowIso(),
  };
  if (patch.status != null) next.status = normalizeStatus(patch.status);
  if (Object.prototype.hasOwnProperty.call(patch, 'alias')) next.alias = normalizeAlias(patch.alias);
  _state.set(cur.profileId, next);
  pushLifecycle({ kind: 'update', profileId: cur.profileId, at: next.updatedAt, patchKeys: Object.keys(patch) });
  return next;
}

export function markClosed(profileId) {
  ensureWritable();
  return update(profileId, { status: 'closed' });
}

export function deleteSession(profileId) {
  ensureWritable();
  const id = String(profileId || '').trim();
  if (!_state.has(id)) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_session', profileId: id } });
  }
  const removed = _state.get(id);
  invalidateTargetsForSession(removed.instanceId);
  _state.delete(id);
  pushLifecycle({ kind: 'delete', profileId: id, at: nowIso() });
  return removed;
}

function normalizeTargetId(targetId) {
  const id = String(targetId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'target' } });
  if (!/^t_[a-zA-Z0-9_-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'target', value: id } });
  }
  return id;
}

function targetRecord(record, page) {
  const now = nowIso();
  const target = {
    targetId: genTargetId(),
    profileId: record.profileId,
    sessionId: record.instanceId,
    generation: record.generation,
    pageId: `page_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    page,
  };
  _targets.set(target.targetId, target);
  pushLifecycle({
    kind: 'target.allocate',
    targetId: target.targetId,
    profileId: record.profileId,
    sessionId: record.instanceId,
    generation: record.generation,
    pageId: target.pageId,
    at: now,
  });
  return target;
}

export function allocateTarget(profileId, page) {
  ensureWritable();
  const record = read(profileId);
  if (!page) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'page' } });
  return targetRecord(record, page);
}

export function listTargets({ profileId = null } = {}) {
  const pid = profileId == null ? null : String(profileId).trim();
  return [..._targets.values()]
    .filter((target) => !pid || target.profileId === pid)
    .sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);
}

function assertTargetActive(target) {
  const session = _state.get(target.profileId);
  if (
    !session
    || session.status !== 'active'
    || target.status !== 'active'
    || target.sessionId !== session.instanceId
    || target.generation !== session.generation
  ) {
    throw new CamoError({
      code: 'E_STATE_INVALID',
      details: {
        resource: 'browser_target',
        targetId: target.targetId,
        reason: 'target is stale for the current session generation',
        sessionId: target.sessionId,
        generation: target.generation,
      },
    });
  }
  return target;
}

export function resolveTarget(targetId, { profileId = null } = {}) {
  const id = normalizeTargetId(targetId);
  const target = _targets.get(id);
  if (!target) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_target', targetId: id } });
  }
  const expectedProfile = profileId == null ? null : String(profileId).trim();
  if (expectedProfile && target.profileId !== expectedProfile) {
    throw new CamoError({
      code: 'E_STATE_INVALID',
      details: {
        resource: 'browser_target',
        targetId: id,
        reason: 'target belongs to a different profile',
        targetProfileId: target.profileId,
        requestedProfileId: expectedProfile,
      },
    });
  }
  return assertTargetActive(target);
}

export function resolveTargetForProfile(profileId) {
  const pid = String(profileId || '').trim();
  if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  const targets = listTargets({ profileId: pid }).filter((target) => {
    try {
      assertTargetActive(target);
      return true;
    } catch {
      return false;
    }
  });
  if (targets.length === 0) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_target', profileId: pid } });
  }
  if (targets.length > 1) {
    throw new CamoError({
      code: 'E_STATE_INVALID',
      details: {
        resource: 'browser_target',
        profileId: pid,
        reason: 'multiple active targets; --target is required',
        targets: targets.map((target) => target.targetId),
      },
    });
  }
  return resolveTarget(targets[0].targetId, { profileId: pid });
}

export function invalidateTarget(targetId) {
  ensureWritable();
  const id = normalizeTargetId(targetId);
  const target = _targets.get(id);
  if (!target) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_target', targetId: id } });
  }
  target.status = 'stale';
  target.updatedAt = nowIso();
  pushLifecycle({ kind: 'target.invalidate', targetId: id, profileId: target.profileId, at: target.updatedAt });
  return target;
}

function invalidateTargetsForSession(sessionId) {
  for (const target of _targets.values()) {
    if (target.sessionId !== sessionId || target.status !== 'active') continue;
    target.status = 'stale';
    target.updatedAt = nowIso();
    pushLifecycle({
      kind: 'target.invalidate',
      targetId: target.targetId,
      profileId: target.profileId,
      sessionId,
      reason: 'session closed',
      at: target.updatedAt,
    });
  }
}

export function isAliasTaken(alias) {
  const target = String(alias || '').trim();
  if (!target) return false;
  for (const [, s] of _state) if (s.alias === target) return true;
  return false;
}

export function lifecycle() {
  return _lifecycle.slice();
}

// Test seam: reset state.
export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _state.clear();
  _lifecycle.length = 0;
  _targets.clear();
}
