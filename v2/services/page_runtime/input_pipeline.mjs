// Input pipeline (mouse/keyboard). Single truth_owner for resource_id=input_pipeline.
//
// The pipeline serializes human-like input operations per profileId.
// It delegates actual browser operations to page_ops.mjs.
//
// Hard guards:
//   - At most one in-flight operation per profileId.
//   - Operations run in declared order; an overlapping run() throws.
//   - Status is observable: { running: bool, lastKind, lastFinishedAt, queueDepth }.
//   - No v1 fallback to input-ops.js or core/actions.mjs.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import * as pageOps from './operations/page_ops.mjs';

const ALLOWED_KINDS = new Set(['goto', 'click', 'type', 'scroll', 'screenshot', 'snapshot', 'wait', 'evaluate', 'upload', 'select', 'back', 'switchPage', 'hover', 'getText', 'getPageInfo', 'findElements', 'getReadable', 'newTab', 'closeTab', 'listTabs', 'getCookies', 'setCookies', 'setUserAgent', 'setViewport', 'waitForDomStable', 'scrollAndCollect', 'fetch']);

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'input_pipeline.write', reason: 'manager not in writable scope' } });
  }
}
// Read-only entry paths (status) are always available; reads
// never throw on enable gate.

const _state = new Map();   // profileId -> { running: bool, op: any, finishedAt, queueDepth, lastError }

function nowIso() { return new Date().toISOString(); }

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

// --- Public API: individual operation functions ---

export async function goto({ profileId, url, waitUntil }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'goto' } });
  }
  s.running = true;
  s.op = { kind: 'goto', params: { url, waitUntil } };
  s.startedAt = nowIso();
  s.lastKind = 'goto';
  try {
    const result = await pageOps.goto({ profileId: pid, url, waitUntil });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function click({ profileId, selector, text, button }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'click' } });
  }
  s.running = true;
  s.op = { kind: 'click', params: { selector, text, button } };
  s.startedAt = nowIso();
  s.lastKind = 'click';
  try {
    const result = await pageOps.click({ profileId: pid, selector, text, button });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function type({ profileId, text, delay }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'type' } });
  }
  s.running = true;
  s.op = { kind: 'type', params: { text, delay } };
  s.startedAt = nowIso();
  s.lastKind = 'type';
  try {
    const result = await pageOps.type({ profileId: pid, text, delay });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function scroll({ profileId, x, y }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'scroll' } });
  }
  s.running = true;
  s.op = { kind: 'scroll', params: { x, y } };
  s.startedAt = nowIso();
  s.lastKind = 'scroll';
  try {
    const result = await pageOps.scroll({ profileId: pid, x, y });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function screenshot({ profileId, fullPage }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'screenshot' } });
  }
  s.running = true;
  s.op = { kind: 'screenshot', params: { fullPage } };
  s.startedAt = nowIso();
  s.lastKind = 'screenshot';
  try {
    const result = await pageOps.screenshot({ profileId: pid, fullPage });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function snapshot({ profileId }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'snapshot' } });
  }
  s.running = true;
  s.op = { kind: 'snapshot', params: {} };
  s.startedAt = nowIso();
  s.lastKind = 'snapshot';
  try {
    const result = await pageOps.snapshot({ profileId: pid });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function wait({ profileId, ms }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'wait' } });
  }
  s.running = true;
  s.op = { kind: 'wait', params: { ms } };
  s.startedAt = nowIso();
  s.lastKind = 'wait';
  try {
    const result = await pageOps.wait({ profileId: pid, ms });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function evaluate({ profileId, script }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'evaluate' } });
  }
  s.running = true;
  s.op = { kind: 'evaluate', params: { script } };
  s.startedAt = nowIso();
  s.lastKind = 'evaluate';
  try {
    const result = await pageOps.evaluate({ profileId: pid, script });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function upload({ profileId, selector, files }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'upload' } });
  }
  s.running = true;
  s.op = { kind: 'upload', params: { selector, files } };
  s.startedAt = nowIso();
  s.lastKind = 'upload';
  try {
    const result = await pageOps.upload({ profileId: pid, selector, files });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function select({ profileId, selector, value }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'select' } });
  }
  s.running = true;
  s.op = { kind: 'select', params: { selector, value } };
  s.startedAt = nowIso();
  s.lastKind = 'select';
  try {
    const result = await pageOps.select({ profileId: pid, selector, value });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}


export async function hover({ profileId, selector, text }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'hover' } });
  }
  s.running = true;
  s.op = { kind: 'hover', params: { selector, text } };
  s.startedAt = nowIso();
  s.lastKind = 'hover';
  try {
    const result = await pageOps.hover({ profileId: pid, selector, text });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function getText({ profileId, selector }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'getText' } });
  }
  s.running = true;
  s.op = { kind: 'getText', params: { selector } };
  s.startedAt = nowIso();
  s.lastKind = 'getText';
  try {
    const result = await pageOps.getText({ profileId: pid, selector });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function getPageInfo({ profileId }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'getPageInfo' } });
  }
  s.running = true;
  s.op = { kind: 'getPageInfo', params: {} };
  s.startedAt = nowIso();
  s.lastKind = 'getPageInfo';
  try {
    const result = await pageOps.getPageInfo({ profileId: pid });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function findElements({ profileId, selector, text }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'findElements' } });
  }
  s.running = true;
  s.op = { kind: 'findElements', params: { selector, text } };
  s.startedAt = nowIso();
  s.lastKind = 'findElements';
  try {
    const result = await pageOps.findElements({ profileId: pid, selector, text });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function getReadable({ profileId, maxLength }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'getReadable' } });
  }
  s.running = true;
  s.op = { kind: 'getReadable', params: { maxLength } };
  s.startedAt = nowIso();
  s.lastKind = 'getReadable';
  try {
    const result = await pageOps.getReadable({ profileId: pid, maxLength });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function newTab({ profileId, url }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'newTab' } });
  }
  s.running = true;
  s.op = { kind: 'newTab', params: { url } };
  s.startedAt = nowIso();
  s.lastKind = 'newTab';
  try {
    const result = await pageOps.newTab({ profileId: pid, url });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function closeTab({ profileId, tabId }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'closeTab' } });
  }
  s.running = true;
  s.op = { kind: 'closeTab', params: { tabId } };
  s.startedAt = nowIso();
  s.lastKind = 'closeTab';
  try {
    const result = await pageOps.closeTab({ profileId: pid, tabId });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function listTabs({ profileId }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'listTabs' } });
  }
  s.running = true;
  s.op = { kind: 'listTabs', params: {} };
  s.startedAt = nowIso();
  s.lastKind = 'listTabs';
  try {
    const result = await pageOps.listTabs({ profileId: pid });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function getCookies({ profileId }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'getCookies' } });
  }
  s.running = true;
  s.op = { kind: 'getCookies', params: {} };
  s.startedAt = nowIso();
  s.lastKind = 'getCookies';
  try {
    const result = await pageOps.getCookies({ profileId: pid });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function setCookies({ profileId, cookies }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'setCookies' } });
  }
  s.running = true;
  s.op = { kind: 'setCookies', params: { cookies } };
  s.startedAt = nowIso();
  s.lastKind = 'setCookies';
  try {
    const result = await pageOps.setCookies({ profileId: pid, cookies });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function setUserAgent({ profileId, userAgent }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'setUserAgent' } });
  }
  s.running = true;
  s.op = { kind: 'setUserAgent', params: { userAgent } };
  s.startedAt = nowIso();
  s.lastKind = 'setUserAgent';
  try {
    const result = await pageOps.setUserAgent({ profileId: pid, userAgent });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function setViewport({ profileId, width, height }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'setViewport' } });
  }
  s.running = true;
  s.op = { kind: 'setViewport', params: { width, height } };
  s.startedAt = nowIso();
  s.lastKind = 'setViewport';
  try {
    const result = await pageOps.setViewport({ profileId: pid, width, height });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function waitForDomStable({ profileId, timeout, pollInterval }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'waitForDomStable' } });
  }
  s.running = true;
  s.op = { kind: 'waitForDomStable', params: { timeout, pollInterval } };
  s.startedAt = nowIso();
  s.lastKind = 'waitForDomStable';
  try {
    const result = await pageOps.waitForDomStable({ profileId: pid, timeout, pollInterval });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function scrollAndCollect({ profileId, scrollCount, scrollDelay }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'scrollAndCollect' } });
  }
  s.running = true;
  s.op = { kind: 'scrollAndCollect', params: { scrollCount, scrollDelay } };
  s.startedAt = nowIso();
  s.lastKind = 'scrollAndCollect';
  try {
    const result = await pageOps.scrollAndCollect({ profileId: pid, scrollCount, scrollDelay });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

export async function fetch({ profileId, url, timeout }) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const s = getState(pid);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId: pid, kind: 'fetch' } });
  }
  s.running = true;
  s.op = { kind: 'fetch', params: { url, timeout } };
  s.startedAt = nowIso();
  s.lastKind = 'fetch';
  try {
    const result = await pageOps.fetch({ profileId: pid, url, timeout });
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = null;
    return result;
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw cause;
  }
}

// --- Legacy run() API (for compatibility) ---
export function run(profileId, op, executor) {
  ensureWritable();
  const s = getState(profileId);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId, kind: s.op?.kind } });
  }
  const kind = normalizeKind(op?.kind);
  s.running = true;
  s.op = { kind, params: op?.params ?? null };
  s.startedAt = nowIso();
  s.lastKind = kind;
  if (typeof executor !== 'function') {
    s.running = false;
    s.finishedAt = nowIso();
    return { profileId, kind, executed: false };
  }
  let result;
  try {
    result = executor({ profileId, kind, params: op?.params });
  } catch (cause) {
    s.running = false;
    s.finishedAt = nowIso();
    s.lastError = String(cause?.message || cause);
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'input_pipeline.run', kind, profileId }, cause });
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then(
      (val) => { s.running = false; s.finishedAt = nowIso(); s.lastError = null; return val; },
      (cause) => { s.running = false; s.finishedAt = nowIso(); s.lastError = String(cause?.message || cause); throw cause; }
    );
  }
  s.running = false;
  s.finishedAt = nowIso();
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
