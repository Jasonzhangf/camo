const BROWSER_COMMANDS = new Set([
  'goto',
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
]);

export function isBrowserCommand(cmd) {
  return BROWSER_COMMANDS.has(cmd);
}

export function browserCommandNames() {
  return [...BROWSER_COMMANDS];
}
