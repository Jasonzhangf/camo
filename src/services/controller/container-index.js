import fs from 'node:fs';

export function loadContainerIndex(indexPath, errorHandler = null) {
  if (!indexPath) {
    throw new Error('CAMO_CONTAINER_INDEX is required; internal container index is not bundled.');
  }
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Container index not found: ${indexPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8')) || {};
  } catch (err) {
    if (errorHandler?.debug) {
      errorHandler.debug('controller', 'read container index failed', { error: err?.message || String(err) });
    }
    throw err;
  }
}

export function resolveSiteKeyFromUrl(url, index) {
  if (!url) return null;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  let bestKey = null;
  let bestLen = -1;
  for (const [key, meta] of Object.entries(index || {})) {
    const domain = (meta?.website || '').toLowerCase();
    if (!domain) continue;
    if (host === domain || host.endsWith(`.${domain}`)) {
      if (domain.length > bestLen) {
        bestKey = key;
        bestLen = domain.length;
      }
    }
  }
  return bestKey;
}

export function inferSiteFromContainerId(containerId) {
  if (!containerId) return null;
  const dotIdx = containerId.indexOf('.');
  if (dotIdx > 0) return containerId.slice(0, dotIdx);
  const underscoreIdx = containerId.indexOf('_');
  if (underscoreIdx > 0) return containerId.slice(0, underscoreIdx);
  return null;
}
