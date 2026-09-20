const BROWSER_COMMANDS = new Set([
  'goto',
  'back',
  'forward',
  'reload',
  'click',
  'type',
  'scroll',
  'screenshot',
  'snapshot',
  'wait',
  'evaluate',
  'upload',
  'select',
  'hover',
  'fetch-page',
  'find-elements',
  'get-cookies',
  'get-page-info',
  'get-readable',
  'get-text',
  'list-tabs',
  'new-tab',
  'close-tab',
  'switch-tab',
  'multi-open',
  'scroll-and-collect',
  'set-cookies',
  'set-user-agent',
  'set-viewport',
  'wait-dom-stable',
]);

export function isBrowserCommand(cmd) {
  return BROWSER_COMMANDS.has(cmd);
}

export function browserCommandNames() {
  return [...BROWSER_COMMANDS];
}
