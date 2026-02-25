function isTruthy(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(text);
}

export function isJsExecutionEnabled() {
  return isTruthy(process.env.CAMO_ALLOW_JS);
}

export function ensureJsExecutionEnabled(scope = 'JavaScript execution') {
  if (isJsExecutionEnabled()) return;
  throw new Error(`${scope} is disabled by default. Re-run with --js to enable.`);
}
