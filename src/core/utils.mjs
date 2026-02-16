/**
 * Core utilities
 */

/**
 * Wait helper
 */
export function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with backoff
 */
export async function retry(fn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const delay = options.delay || 1000;
  const backoff = options.backoff || 2;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await waitFor(delay * Math.pow(backoff, attempt - 1));
      }
    }
  }

  throw lastError;
}

/**
 * Timeout wrapper
 */
export async function withTimeout(promise, ms, message = 'Timeout') {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Format URL (ensure scheme)
 */
export function ensureUrlScheme(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('localhost') || url.match(/^\\d+\\.\\d+/)) {
    return `http://${url}`;
  }
  return `https://${url}`;
}

/**
 * Looks like URL token
 */
export function looksLikeUrlToken(token) {
  if (!token || typeof token !== 'string') return false;
  if (token.startsWith('http://') || token.startsWith('https://')) return true;
  if (token.includes('.') && !token.includes(' ')) return true;
  return false;
}

/**
 * Get positional args (exclude flags)
 */
export function getPositionals(args, excludeFlags = []) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!excludeFlags.includes(arg)) {
        i++; // skip value
      }
      continue;
    }
    if (excludeFlags.includes(arg)) {
      i++; // skip value
      continue;
    }
    result.push(arg);
  }
  return result;
}
