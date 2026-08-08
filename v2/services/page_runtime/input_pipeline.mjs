// Input pipeline (mouse/keyboard). truth_owner: input_pipeline.
//
// The pipeline serializes human-like input operations per profileId.
// It delegates actual browser operations to page_ops.mjs.
//
// Architecture:
//   - _pipeline_state.mjs: state management, safeId, ALLOWED_KINDS, wrapOperation factory
//   - operations/page_ops.mjs: re-export layer to sub-modules
//   - operations/navigation_ops.mjs: goto, newTab, closeTab, listTabs
//   - operations/interaction_ops.mjs: click, hover, type, scroll, upload, select
//   - operations/query_ops.mjs: screenshot, snapshot, getText, getPageInfo, findElements, getReadable
//   - operations/config_ops.mjs: getCookies, setCookies, setUserAgent, setViewport
//   - operations/wait_ops.mjs: wait, waitForDomStable
//   - operations/advanced_ops.mjs: evaluate, scrollAndCollect, fetch
//
// Hard guards:
//   - At most one in-flight operation per profileId.
//   - Operations run in declared order; overlapping run() throws.
//   - Status is observable: { running, lastKind, lastFinishedAt, queueDepth }.
//   - No v1 fallback.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import * as pageOps from './operations/page_ops.mjs';
import {
  __enableTestRoot,
  __resetForTest,
  wrapOperation,
  getStatus,
  normalizeKind,
  getState,
  ensureWritable,
  safeId,
} from './_pipeline_state.mjs';

// Re-export test helpers
export { __enableTestRoot, __resetForTest };

// Build wrapper functions for all 25 operations using the factory.
export const goto = wrapOperation('goto', pageOps.goto);
export const click = wrapOperation('click', pageOps.click);
export const type = wrapOperation('type', pageOps.type);
export const scroll = wrapOperation('scroll', pageOps.scroll);
export const screenshot = wrapOperation('screenshot', pageOps.screenshot);
export const snapshot = wrapOperation('snapshot', pageOps.snapshot);
export const wait = wrapOperation('wait', pageOps.wait);
export const evaluate = wrapOperation('evaluate', pageOps.evaluate);
export const upload = wrapOperation('upload', pageOps.upload);
export const select = wrapOperation('select', pageOps.select);
export const hover = wrapOperation('hover', pageOps.hover);
export const getText = wrapOperation('getText', pageOps.getText);
export const getPageInfo = wrapOperation('getPageInfo', pageOps.getPageInfo);
export const findElements = wrapOperation('findElements', pageOps.findElements);
export const getReadable = wrapOperation('getReadable', pageOps.getReadable);
export const newTab = wrapOperation('newTab', pageOps.newTab);
export const closeTab = wrapOperation('closeTab', pageOps.closeTab);
export const listTabs = wrapOperation('listTabs', pageOps.listTabs);
export const switchTab = wrapOperation('switchTab', pageOps.switchTab);
export const getCookies = wrapOperation('getCookies', pageOps.getCookies);
export const setCookies = wrapOperation('setCookies', pageOps.setCookies);
export const setUserAgent = wrapOperation('setUserAgent', pageOps.setUserAgent);
export const setViewport = wrapOperation('setViewport', pageOps.setViewport);
export const waitForDomStable = wrapOperation('waitForDomStable', pageOps.waitForDomStable);
export const scrollAndCollect = wrapOperation('scrollAndCollect', pageOps.scrollAndCollect);
export const fetch = wrapOperation('fetch', pageOps.fetch);

// --- Legacy run() API ---
export function run(profileId, op, executor) {
  ensureWritable();
  const s = getState(profileId);
  if (s.running) {
    throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'input_pipeline', profileId, kind: s.op?.kind } });
  }
  const kind = normalizeKind(op?.kind);
  s.running = true;
  s.op = { kind, params: op?.params ?? null };
  s.startedAt = new Date().toISOString();
  s.lastKind = kind;
  if (typeof executor !== 'function') {
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
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then(
      (val) => { s.running = false; s.finishedAt = new Date().toISOString(); s.lastError = null; return val; },
      (cause) => { s.running = false; s.finishedAt = new Date().toISOString(); s.lastError = String(cause?.message || cause); throw cause; }
    );
  }
  s.running = false;
  s.finishedAt = new Date().toISOString();
  s.lastError = null;
  return result;
}

export function status(profileId) {
  return getStatus(profileId);
}
