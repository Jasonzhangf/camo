import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_DATA_ROOT = String(process.env.CAMO_DATA_ROOT || '').trim()
  || path.join(os.homedir(), '.camo');
const DEFAULT_CONTAINER_ROOT = String(process.env.CAMO_CONTAINER_ROOT || '').trim()
  || path.join(DEFAULT_DATA_ROOT, 'containers');

function resolveIndexPath() {
  const envPath = String(process.env.CAMO_CONTAINER_INDEX || '').trim();
  if (envPath) return path.resolve(envPath);
  return path.join(DEFAULT_CONTAINER_ROOT, 'container-library.index.json');
}

function resolveBuiltinRoot() {
  const envRoot = String(process.env.CAMO_CONTAINER_BUILTIN_ROOT || '').trim();
  if (envRoot) return path.resolve(envRoot);
  return DEFAULT_CONTAINER_ROOT;
}

function resolveUserRoot() {
  const envRoot = String(process.env.CAMO_CONTAINER_USER_ROOT || '').trim();
  if (envRoot) return path.resolve(envRoot);
  return path.join(DEFAULT_CONTAINER_ROOT, 'user');
}

function isLegacyContainer(definition) {
  try {
    return Boolean(definition?.metadata?.legacy_data);
  } catch {
    return false;
  }
}

export class ContainerRegistry {
  constructor() {
    this.indexCache = null;
  }

  listSites() {
    const registry = this.ensureIndex();
    return Object.entries(registry).map(([key, meta]) => ({
      key,
      website: meta.website || '',
      path: meta.path || '',
    }));
  }

  getContainersForSite(siteKey) {
    if (!siteKey) return {};
    const registry = this.ensureIndex();
    const site = registry[siteKey] || { path: path.join('containers', siteKey) };
    return this.fetchContainersForSite(siteKey, site);
  }

  resolveSiteKey(url) {
    const registry = this.ensureIndex();
    return this.findSiteKey(url, registry);
  }

  async load() {
    this.ensureIndex();
  }

  getContainersForUrl(url) {
    const registry = this.ensureIndex();
    const siteKey = this.findSiteKey(url, registry);
    if (!siteKey) return {};
    const site = registry[siteKey] || { path: path.join('containers', siteKey) };
    return this.fetchContainersForSite(siteKey, site);
  }

  fetchContainersForSite(siteKey, site) {
    return this.loadSiteContainers(siteKey, site?.path);
  }

  ensureIndex() {
    if (this.indexCache) return this.indexCache;
    const indexPath = resolveIndexPath();
    if (fs.existsSync(indexPath)) {
      try {
        this.indexCache = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) || {};
        return this.indexCache;
      } catch {
        // fall through
      }
    }
    this.indexCache = {};
    return this.indexCache;
  }

  loadSiteContainers(siteKey, relativePath) {
    const containers = {};
    const builtinRoot = resolveBuiltinRoot();
    const userRoot = resolveUserRoot();
    const builtinPath = path.join(builtinRoot, relativePath || path.join('containers', siteKey));
    if (fs.existsSync(builtinPath)) {
      this.walkSite(builtinPath, containers);
      this.loadLegacyFile(builtinPath, containers);
    }

    const userPath = path.join(userRoot, siteKey);
    if (fs.existsSync(userPath)) {
      this.walkSite(userPath, containers);
      this.loadLegacyFile(userPath, containers);
    }
    return containers;
  }

  walkSite(sitePath, output) {
    const stack = [{ dir: sitePath, parts: [] }];
    while (stack.length) {
      const { dir, parts } = stack.pop();
      let hasContainerFile = false;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === 'container.json') {
          const relParts = parts.length ? parts : [path.basename(dir)];
          const containerId = relParts.join('.');
          try {
            const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf-8'));
            if (raw && typeof raw === 'object') {
              if (isLegacyContainer(raw)) continue;
              const id = raw.id || containerId;
              output[id] = { id, ...raw };
            }
          } catch {
            // ignore malformed container
          }
          hasContainerFile = true;
        } else if (entry.isDirectory()) {
          stack.push({ dir: path.join(dir, entry.name), parts: [...parts, entry.name] });
        }
      }
      if (!hasContainerFile && parts.length === 0) {
        continue;
      }
    }
  }

  loadLegacyFile(sitePath, output) {
    const legacyFile = path.join(sitePath, 'containers.json');
    if (!fs.existsSync(legacyFile)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
      const containers = raw?.containers;
      if (containers && typeof containers === 'object') {
        for (const [key, value] of Object.entries(containers)) {
          if (!output[key] && value && typeof value === 'object') {
            if (isLegacyContainer(value)) continue;
            output[key] = { id: key, ...(value) };
          }
        }
      }
    } catch {
      // ignore legacy parse error
    }
  }

  findSiteKey(url, registry) {
    let host = '';
    try {
      const parsed = new URL(url);
      host = (parsed.hostname || '').toLowerCase();
    } catch {
      return null;
    }
    let bestKey = null;
    let bestLen = -1;
    for (const [key, value] of Object.entries(registry)) {
      const domain = String(value.website || '').toLowerCase();
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
}
