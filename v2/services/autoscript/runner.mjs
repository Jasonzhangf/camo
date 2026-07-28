// Autoscript runner. Single truth_owner for resource_id=autoscript_run.
//
// One run is identified by runId and is owned by a single profileId.
// A run progresses through:
//   pending -> running -> (paused -> running)+ -> finished | failed | cancelled
//
// Hard guards:
//   - Only this module mutates state.
//   - Pause on terminal state throws E_STATE_TERMINAL.
//   - Stop on already-terminal is a no-op (returns current record).
//   - Each transition is appended to a lifecycle log used by tests.
//   - No v1 fallback to commands/autoscript.mjs.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const ALLOWED_STATUS = new Set(['pending', 'running', 'paused', 'finished', 'failed', 'cancelled']);
const TERMINAL = new Set(['finished', 'failed', 'cancelled']);

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'autoscript.write', reason: 'manager not in writable scope' } });
  }
}

const _runs = new Map();   // runId -> record
const _lifecycle = [];     // append-only event log

function nowIso() { return new Date().toISOString(); }

function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!ALLOWED_STATUS.has(v)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'status', value: s, allowed: [...ALLOWED_STATUS] } });
  }
  return v;
}

export function start(runId, profileId, opts = {}) {
  ensureWritable();
  const rid = safeId(runId, 'runId');
  if (_runs.has(rid)) {
    throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'autoscript_run', runId: rid } });
  }
  const pid = safeId(profileId, 'profileId');
  const now = nowIso();
  const rec = {
    runId: rid,
    profileId: pid,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    lastError: null,
    stepCount: 0,
    metadata: opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {},
  };
  _runs.set(rid, rec);
  _lifecycle.push({ kind: 'start', runId: rid, profileId: pid, at: now });
  return rec;
}

function transition(runId, target, extra = {}) {
  ensureWritable();
  const rid = safeId(runId, 'runId');
  const cur = _runs.get(rid);
  if (!cur) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'autoscript_run', runId: rid } });
  }
  const t = normalizeStatus(target);
  if (TERMINAL.has(cur.status)) {
    throw new CamoError({ code: 'E_STATE_TERMINAL', details: { resource: 'autoscript_run', runId: rid, current: cur.status, target: t } });
  }
  const now = nowIso();
  cur.status = t;
  if (t === 'running' && !cur.startedAt) cur.startedAt = now;
  if (TERMINAL.has(t)) cur.finishedAt = now;
  if (extra.error != null) cur.lastError = String(extra.error);
  if (Number.isFinite(extra.stepCount)) cur.stepCount = Math.max(0, Math.floor(extra.stepCount));
  _lifecycle.push({ kind: t, runId: rid, at: now });
  return cur;
}

export function markRunning(runId, opts = {}) { return transition(runId, 'running', opts); }
export function markPaused(runId, opts = {})  { return transition(runId, 'paused', opts); }
export function markFinished(runId, opts = {}) { return transition(runId, 'finished', opts); }
export function markFailed(runId, opts = {}) {
  if (!opts.error) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'error' } });
  }
  return transition(runId, 'failed', opts);
}
export function markCancelled(runId, opts = {}) { return transition(runId, 'cancelled', opts); }

export function stop(runId, opts = {}) {
  ensureWritable();
  const rid = safeId(runId, 'runId');
  const cur = _runs.get(rid);
  if (!cur) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'autoscript_run', runId: rid } });
  }
  if (TERMINAL.has(cur.status)) return cur; // already terminal, no-op
  return transition(rid, 'cancelled', opts);
}

export function status(runId) {
  const rid = safeId(runId, 'runId');
  const cur = _runs.get(rid);
  if (!cur) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'autoscript_run', runId: rid } });
  }
  return cur;
}

export function read(runId) { return status(runId); }

export function list(profileId) {
  if (profileId == null) return [..._runs.values()];
  const pid = safeId(profileId, 'profileId');
  return [..._runs.values()].filter((r) => r.profileId === pid);
}

export function lifecycle() {
  return _lifecycle.slice();
}


export function execute(runId, actionId, params, ctx) {
  ensureWritable();
  const rid = safeId(runId, 'runId');
  const cur = _runs.get(rid);
  if (!cur) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'autoscript_run', runId: rid } });
  }
  if (TERMINAL.has(cur.status)) {
    throw new CamoError({ code: 'E_STATE_TERMINAL', details: { resource: 'autoscript_run', runId: rid, current: cur.status } });
  }
  const aid = String(actionId || '').trim();
  if (!aid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'actionId' } });
  if (cur.status === 'pending') {
    transition(rid, 'running');
  }
  let mod;
  try {
    mod = _actionModules.get(aid);
  } catch (cause) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'action.load', actionId: aid }, cause });
  }
  if (!mod || typeof mod.run !== 'function') {
    throw new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { actionId: aid, runId: rid } });
  }
  let result;
  try {
    result = mod.run({ params: params || {}, ctx: ctx || {} });
  } catch (cause) {
    transition(rid, 'failed', { error: String(cause?.message || cause) });
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'action.run', actionId: aid, runId: rid }, cause });
  }
  cur.stepCount = (cur.stepCount || 0) + 1;
  _lifecycle.push({ kind: 'execute', runId: rid, actionId: aid, at: nowIso(), stepCount: cur.stepCount });
  return result;
}

const _actionModules = new Map();

export function registerAction(actionId, mod) {
  ensureWritable();
  const aid = String(actionId || '').trim();
  if (!aid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'actionId' } });
  if (_actionModules.has(aid)) {
    throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'autoscript_action', actionId: aid } });
  }
  _actionModules.set(aid, mod);
  return { actionId: aid, registered: true };
}

export function unregisterAction(actionId) {
  ensureWritable();
  const aid = String(actionId || '').trim();
  if (!aid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'actionId' } });
  return _actionModules.delete(aid);
}

export function listActions() {
  return [..._actionModules.keys()].sort();
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _runs.clear();
  _actionModules.clear();
  _lifecycle.length = 0;
}
