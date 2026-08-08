// Page operations - unified re-export layer. truth_owner: page_runtime.
//
// This module re-exports all page operations from specialized sub-modules.
// Architecture: input_pipeline -> page_ops -> sub_modules -> camoufox_bridge.
//
// Sub-modules:
//   - _page_helpers.mjs  : shared helpers (safeId, getPageOrThrow, emit, etc.)
//   - navigation_ops.mjs : goto, newTab, closeTab, listTabs
//   - interaction_ops.mjs: click, hover, type, scroll, upload, select
//   - query_ops.mjs      : screenshot, snapshot, getText, getPageInfo, findElements, getReadable
//   - config_ops.mjs     : getCookies, setCookies, setUserAgent, setViewport
//   - wait_ops.mjs       : wait, waitForDomStable
//   - advanced_ops.mjs   : evaluate, scrollAndCollect, fetch

// Re-export all operations for backward compatibility with input_pipeline.
export {
  goto,
  newTab,
  closeTab,
  listTabs,
  switchTab,
} from './navigation_ops.mjs';

export {
  click,
  hover,
  type,
  scroll,
  upload,
  select,
} from './interaction_ops.mjs';

export {
  screenshot,
  snapshot,
  getText,
  getPageInfo,
  findElements,
  getReadable,
} from './query_ops.mjs';

export {
  getCookies,
  setCookies,
  setUserAgent,
  setViewport,
} from './config_ops.mjs';

export {
  wait,
  waitForDomStable,
} from './wait_ops.mjs';

export {
  evaluate,
  scrollAndCollect,
  fetch,
} from './advanced_ops.mjs';
