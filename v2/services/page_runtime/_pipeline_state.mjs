// Input pipeline state management. truth_owner: input_pipeline.
//
// Manages per-profileId operation state with at-most-one-in-flight semantics.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { append as appendProgress } from '../progress_event/log.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }

export function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'input_pipeline.write', reason: 'manager not in writable scope' } });
  }
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _state.clear();
}

export const ALLOWED_KINDS = new Set(['goto', 'back', 'forward', 'reload', 'click', 'type', 'scroll', 'screenshot', 'snapshot', 'wait', 'evaluate', 'upload', 'select', 'hover', 'getText', 'getPageInfo', 'findElements', 'getReadable', 'newTab', 'closeTab', 'listTabs', 'switchTab', 'multiOpen', 'getCookies', 'setCookies', 'setUserAgent', 'setuseragent', 'setViewport', 'waitForDomStable', 'scrollAndCollect', 'fetch']);

const _state = new Map();
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

function nowIso() { return new Date().toISOString(); }

function resolveTimeoutMs(args) {
  const timeout = Number(args?.timeout);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_OPERATION_TIMEOUT_MS;
}

function isPipelineAbort(cause) {
  let current = cause;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (current.code === 'E_IO_TIMEOUT') return true;
    current = current.cause;
  }
  return false;
}

function emitPipelineAborted(profileId, kind, cause) {
  appendProgress({
    event: 'pipeline.aborted',
    source: 'input_pipeline',
    profileId,
    payload: {
      kind,
      code: cause?.code || 'E_INTERNAL_UNEXPECTED',
      reason: cause?.details?.reason || cause?.message || String(cause),
    },
  });
}

function recordFailure(state, profileId, kind, cause) {
  state.running = false;
  state.finishedAt = nowIso();
  state.lastError = String(cause?.message || cause);
  if (isPipelineAbort(cause)) emitPipelineAborted(profileId, kind, cause);
}

async function withOperationTimeout(executor, args, profileId, kind, controller = new AbortController()) {
  const timeoutMs = resolveTimeoutMs(args);
  let timer;
  const timeoutError = new CamoError({
    code: 'E_IO_TIMEOUT',
    details: { op: 'input_pipeline', profileId, kind, timeoutMs, reason: 'operation timeout' },
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => executor(args, controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

export function getState(profileId) {
  const pid = safeId(profileId, 'profileId');
  let s = _state.get(pid);
  if (!s) {
    s = { running: false, op: null, startedAt: null, finishedAt: null, lastKind: null, lastError: null, queueDepth: 0 };
    _state.set(pid, s);
  }
  return s;
}

export function peekState(profileId) {
  const pid = safeId(profileId, 'profileId');
  return _state.get(pid) || null;
}

export function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  if (!ALLOWED_KINDS.has(k)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'kind', value: kind, allowed: [...ALLOWED_KINDS] } });
  }
  return k;
}

/**
 * Create a pipeline-wrapped operation function.
 * Each wrapped op acquires the profile lock, calls the underlying executor, and releases.
 * @param {string} kind - operation kind (must be in ALLOWED_KINDS)
 * @param {Function} executor - underlying async function(profileId, ...args)
 * @returns {Function} wrapped async function(args)
 */
export function wrapOperation(kind, executor) {
  return async function (args) {
    ensureWritable();
    const pid = safeId(args.profileId, 'profileId');
    const s = getState(pid);
    if (s.running) {
      throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind } });
    }
    s.running = true;
    s.op = { kind, params: args };
    s.startedAt = nowIso();
    s.lastKind = kind;
    try {
      const result = await withOperationTimeout(executor, args, pid, kind);
      s.running = false;
      s.finishedAt = nowIso();
      s.lastError = null;
      return result;
    } catch (cause) {
      recordFailure(s, pid, kind, cause);
      throw cause;
    }
  };
}

export { recordFailure, withOperationTimeout };

/**
 * Get status for a profileId (read-only, always available).
 * @param {string} profileId
 * @returns {Object} status snapshot
 */
export function getStatus(profileId) {
  const pid = safeId(profileId, 'profileId');
  const s = peekState(pid);
  if (!s) {
    return {
      profileId: pid,
      running: false,
      op: null,
      startedAt: null,
      finishedAt: null,
      lastKind: null,
      lastError: null,
      queueDepth: 0,
    };
  }
  return {
    profileId: pid,
    running: s.running,
    op: s.op,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    lastKind: s.lastKind,
    lastError: s.lastError,
    queueDepth: s.queueDepth,
  };
}
