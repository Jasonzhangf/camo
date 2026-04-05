/**
 * Platform-aware execution strategy.
 * Windows defaults to non-CDP fallback if configured, or uses CDP otherwise.
 */
function isWindows() {
  return process.platform === 'win32';
}

function isMac() {
  return process.platform === 'darwin';
}

function supportsCDP() {
  // Camoufox CDP on Windows is known to be unstable for heavy evaluation
  // Default to false on Windows to prefer HTTP/ScriptTag fallbacks if available
  return process.platform !== 'win32';
}

module.exports = { isWindows, isMac, supportsCDP };
