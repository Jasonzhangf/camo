/**
 * Core module exports
 */

export * from './browser.mjs';
export * from './actions.mjs';
export * from './utils.mjs';

// Re-export commonly used functions
export {
  detectCamoufoxPath,
  ensureCamoufox,
  launchBrowser,
  stopBrowser,
  getBrowserStatus,
  isBrowserRunning,
  getPlaywrightBrowser,
  getCurrentPage,
  getActiveBrowser,
} from './browser.mjs';

export {
  navigateTo,
  goBack,
  takeScreenshot,
  scrollPage,
  clickElement,
  typeText,
  pressKey,
  highlightElement,
  clearHighlights,
  setViewport,
  getPageInfo,
  getDOMSnapshot,
  queryElements,
  evaluateJS,
  createNewPage,
  listPages,
  switchPage,
  closePage,
  mouseMove,
  mouseClick,
  mouseWheel,
} from './actions.mjs';

export {
  waitFor,
  retry,
  withTimeout,
  ensureUrlScheme,
  looksLikeUrlToken,
  getPositionals,
} from './utils.mjs';
