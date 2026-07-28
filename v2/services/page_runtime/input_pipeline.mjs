// Input pipeline (mouse/keyboard). Single truth_owner for resource_id=input_pipeline.
//
// The pipeline serializes human-like input operations per profileId.
// Hard guards (also enforced by legacy execution chain):
//   - At most one in-flight operation per profileId.
//   - Operations run in declared order; an overlapping run() throws.
//   - Status is observable: { running: bool, lastKind, lastFinishedAt, queueDepth }.
//   - No v1 fallback to input-ops.js or core/actions.mjs.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const ALLOWED_KINDS = new Set(['mouse', 'keyboard', 'click', 'type', 'scroll', 'back', 'switchPage']);

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'input_pipeline.write', reason: 'manager not in writable scope' } });
  }
}

const _state = new Map();   // profileId -> { running: bool, op: any, finishedAt, queueDepth, lastError }

function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

function getState(profileId) {
  const pid = safeId(profileId, 'profileId');
  let s = _state.get(pid);
  if (!s) {
    s = { running: false, op: null, startedAt: null, finishedAt: null, lastKind: null, lastError: null, queueDepth: 0 };
    _state.set(pid, s);
  }
  return s;
}

function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  if (!ALLOWED_KINDS.has(k)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'kind', value: kind, allowed: [...ALLOWED_KINDS] } });
  }
  return k;
}

// run() executes an operation synchronously. The executor is provided
// by the browser-service bootstrap (page primitives). For tests we allow
// `executor` to be optional and only mutate state.
export function run(profileId, op, executor) {
  ensureWritable();
  const s = getState(profileId);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId, kind: s.op?.kind, startedAt: s.startedAt } });
  }
  const kind = normalizeKind(op?.kind);
  s.running = true;
  s.op = { kind, params: op?.params ?? null };
  s.startedAt = new Date().toISOString();
  s.lastKind = kind;
  if (typeof executor !== 'function') {
    // No executor: simulate finished synchronously.
    s.running = false;
    s.finishedAt = new Date().toISOString();
    return { profileId, kind, executed: false };
  }
  let result;
  try {
    result = executor({ profileId, kind, params: op?.params });
  } catch (cause) {
    s.running = false;
    s.finishedAt = new Date().toISOString();
    s.lastError = String(cause?.message || cause);
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'input_pipeline.run', kind, profileId }, cause });
  }
  // If the executor returned a thenable, keep s.running true until it
  // resolves (or rejects). The second run() must still throw E_STATE_LOCKED.
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then(
      (val) => {
        s.running = false;
        s.finishedAt = new Date().toISOString();
        s.lastError = null;
        return val;
      },
      (cause) => {
        s.running = false;
        s.finishedAt = new Date().toISOString();
        s.lastError = String(cause?.message || cause);
        throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'input_pipeline.run', kind, profileId }, cause });
      }
    );
  }
  s.running = false;
  s.finishedAt = new Date().toISOString();
  s.lastError = null;
  return result;
}

export function status(profileId) {
  const s = getState(profileId);
  return {
    profileId: safeId(profileId, 'profileId'),
    running: s.running,
    op: s.op,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    lastKind: s.lastKind,
    lastError: s.lastError,
    queueDepth: s.queueDepth,
  };
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _state.clear();
}
