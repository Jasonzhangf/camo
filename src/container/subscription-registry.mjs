import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findRepoRootCandidate } from '../utils/browser-service.mjs';

const CONTAINER_ROOT_ENV = process.env.WEBAUTO_CONTAINER_ROOT || process.env.ROUTECODEX_CONTAINER_ROOT;

export const USER_CONTAINER_ROOT = CONTAINER_ROOT_ENV || path.join(os.homedir(), '.webauto', 'container-lib');
export const SUBSCRIPTION_ROOT = path.join(os.homedir(), '.webauto', 'container-subscriptions');
export const SUBSCRIPTION_SETS_DIR = path.join(SUBSCRIPTION_ROOT, 'sets');
export const SUBSCRIPTION_INDEX_FILE = path.join(SUBSCRIPTION_ROOT, 'index.json');
export const SUBSCRIPTION_TARGETS_FILE = path.join(SUBSCRIPTION_ROOT, 'targets.json');

function resolveStoragePaths(options = {}) {
  const userContainerRoot = options.userContainerRoot || USER_CONTAINER_ROOT;
  const subscriptionRoot = options.subscriptionRoot || SUBSCRIPTION_ROOT;
  const setsDir = options.setsDir || path.join(subscriptionRoot, 'sets');
  const indexFile = options.indexFile || path.join(subscriptionRoot, 'index.json');
  const targetsFile = options.targetsFile || path.join(subscriptionRoot, 'targets.json');
  return { userContainerRoot, subscriptionRoot, setsDir, indexFile, targetsFile };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function splitLegacySelector(rawSelector) {
  if (typeof rawSelector !== 'string') return [];
  return rawSelector
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSelectors(rawSelectors) {
  const out = [];
  const pushCss = (css, extra = {}) => {
    if (typeof css !== 'string' || !css.trim()) return;
    out.push({
      css: css.trim(),
      ...(typeof extra.variant === 'string' ? { variant: extra.variant } : {}),
      ...(Number.isFinite(Number(extra.score)) ? { score: Number(extra.score) } : {}),
    });
  };

  if (Array.isArray(rawSelectors)) {
    for (const item of rawSelectors) {
      if (typeof item === 'string') {
        for (const css of splitLegacySelector(item)) {
          pushCss(css);
        }
        continue;
      }
      if (item && typeof item === 'object') {
        if (typeof item.css === 'string') {
          pushCss(item.css, item);
        } else if (typeof item.selector === 'string') {
          for (const css of splitLegacySelector(item.selector)) {
            pushCss(css, item);
          }
        } else if (typeof item.id === 'string' && item.id) {
          pushCss(`#${item.id}`, item);
        } else if (Array.isArray(item.classes) && item.classes.length > 0) {
          pushCss(`.${item.classes.filter(Boolean).join('.')}`, item);
        }
      }
    }
  } else if (typeof rawSelectors === 'string') {
    for (const css of splitLegacySelector(rawSelectors)) {
      pushCss(css);
    }
  } else if (rawSelectors && typeof rawSelectors === 'object') {
    if (typeof rawSelectors.css === 'string') {
      pushCss(rawSelectors.css, rawSelectors);
    } else if (typeof rawSelectors.selector === 'string') {
      for (const css of splitLegacySelector(rawSelectors.selector)) {
        pushCss(css, rawSelectors);
      }
    }
  }

  const dedup = new Map();
  for (const item of out) {
    const key = `${item.css}::${item.variant || ''}::${item.score || ''}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  return Array.from(dedup.values());
}

function normalizeChildren(rawChildren) {
  if (!Array.isArray(rawChildren)) return [];
  return rawChildren.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function normalizePagePatterns(raw) {
  const out = [];
  const fromArray = Array.isArray(raw.page_patterns) ? raw.page_patterns : [];
  const fromCamel = Array.isArray(raw.pagePatterns) ? raw.pagePatterns : [];
  const fromUrl = typeof raw.page_url === 'string' && raw.page_url.trim() ? [raw.page_url.trim()] : [];
  for (const item of [...fromArray, ...fromCamel, ...fromUrl]) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
  }
  return Array.from(new Set(out));
}

function parseCssFingerprint(css) {
  const normalizedCss = typeof css === 'string' ? css.trim() : '';
  if (!normalizedCss) {
    return { css: null, tag: null, id: null, classes: [] };
  }
  const tagMatch = normalizedCss.match(/^[a-zA-Z][\w-]*/);
  const idMatch = normalizedCss.match(/#([\w-]+)/);
  const classMatches = normalizedCss.match(/\.([\w-]+)/g) || [];
  return {
    css: normalizedCss,
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    id: idMatch ? idMatch[1] : null,
    classes: classMatches.map((item) => item.slice(1)),
  };
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[^\w.-]/g, '_')
    .slice(0, 180);
}

function inferSiteKey(containerId, fallbackSiteKey) {
  if (typeof containerId === 'string') {
    const under = containerId.match(/^([a-z0-9-]+)_/i);
    if (under?.[1]) return under[1].toLowerCase();
  }
  return String(fallbackSiteKey || 'default').toLowerCase();
}

function buildSetDefinition({ id, siteKey, sourceRelPath, raw }) {
  const selectors = normalizeSelectors(raw.selectors || raw.selector);
  const pagePatterns = normalizePagePatterns(raw);
  const sourceKind = sourceRelPath.endsWith('containers.json') ? 'legacy-map' : 'tree-v2';
  const containerPath = sourceKind === 'tree-v2'
    ? sourceRelPath.replace(/\/container\.json$/, '')
    : `${siteKey}/${id.replace(/\./g, '/')}`;

  const markers = [
    {
      markerType: 'path',
      siteKey: inferSiteKey(id, siteKey),
      containerId: id,
      containerPath,
    },
    ...selectors.map((selectorDef, idx) => ({
      markerType: 'url_dom',
      siteKey: inferSiteKey(id, siteKey),
      containerId: id,
      markerId: `${id}#${idx + 1}`,
      urlPatterns: pagePatterns,
      dom: {
        ...parseCssFingerprint(selectorDef.css),
        variant: selectorDef.variant || null,
        score: Number.isFinite(Number(selectorDef.score)) ? Number(selectorDef.score) : null,
      },
    })),
  ];

  return {
    id,
    siteKey: inferSiteKey(id, siteKey),
    name: raw.name || id,
    type: raw.type || 'container',
    pagePatterns,
    selectors,
    selectorCount: selectors.length,
    children: normalizeChildren(raw.children),
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
    markers,
    markerCount: markers.length,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    source: {
      kind: sourceKind,
      path: sourceRelPath,
    },
  };
}

function collectJsonFiles(dirPath) {
  const out = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function detectContainerLibraryRoot(explicitRoot) {
  if (explicitRoot) return explicitRoot;
  const repoRoot = findRepoRootCandidate();
  if (!repoRoot) return null;
  const candidate = path.join(repoRoot, 'container-library');
  return fs.existsSync(candidate) ? candidate : null;
}

function bootstrapUserContainerRoot(containerLibraryRoot, options = {}) {
  const force = options.force === true;
  const userContainerRoot = options.userContainerRoot || USER_CONTAINER_ROOT;
  ensureDir(userContainerRoot);
  const topLevel = fs.readdirSync(containerLibraryRoot, { withFileTypes: true });
  let copiedEntries = 0;
  for (const entry of topLevel) {
    if (!entry.isDirectory()) continue;
    const src = path.join(containerLibraryRoot, entry.name);
    const dst = path.join(userContainerRoot, entry.name);
    if (fs.existsSync(dst) && !force) continue;
    fs.cpSync(src, dst, { recursive: true, force });
    copiedEntries += 1;
  }
  return { root: userContainerRoot, copiedEntries };
}

export function initContainerSubscriptionDirectory(options = {}) {
  const storage = resolveStoragePaths(options);
  const containerLibraryRoot = detectContainerLibraryRoot(options.containerLibraryRoot);
  if (!containerLibraryRoot || !fs.existsSync(containerLibraryRoot)) {
    throw new Error(
      'container-library not found. Set WEBAUTO_REPO_ROOT or run `camo config repo-root <webauto-path>` first.',
    );
  }

  ensureDir(storage.subscriptionRoot);
  ensureDir(storage.setsDir);
  const boot = bootstrapUserContainerRoot(containerLibraryRoot, {
    force: options.force === true,
    userContainerRoot: storage.userContainerRoot,
  });

  const jsonFiles = collectJsonFiles(containerLibraryRoot);
  const setMap = new Map();

  for (const filePath of jsonFiles) {
    const rel = path.relative(containerLibraryRoot, filePath).replace(/\\/g, '/');
    const raw = readJsonFile(filePath, null);
    if (!raw || typeof raw !== 'object') continue;
    const siteKey = rel.split('/')[0] || 'default';

    if (filePath.endsWith(`${path.sep}container.json`) || rel.endsWith('/container.json')) {
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
      if (!id) continue;
      setMap.set(id, buildSetDefinition({ id, siteKey, sourceRelPath: rel, raw }));
      continue;
    }

    if (filePath.endsWith(`${path.sep}containers.json`) || rel.endsWith('/containers.json')) {
      const containers = raw.containers;
      if (!containers || typeof containers !== 'object') continue;
      for (const [id, def] of Object.entries(containers)) {
        if (!id || !def || typeof def !== 'object') continue;
        if (setMap.has(id)) continue;
        setMap.set(id, buildSetDefinition({ id, siteKey, sourceRelPath: rel, raw: def }));
      }
    }
  }

  const sets = Array.from(setMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  for (const set of sets) {
    const fileName = `${sanitizeFileName(set.id)}.json`;
    toJsonFile(path.join(storage.setsDir, fileName), set);
  }

  const bySite = {};
  for (const set of sets) {
    if (!bySite[set.siteKey]) bySite[set.siteKey] = [];
    bySite[set.siteKey].push(set.id);
  }

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: containerLibraryRoot,
    userContainerRoot: storage.userContainerRoot,
    setCount: sets.length,
    sites: Object.fromEntries(
      Object.entries(bySite).map(([site, ids]) => [site, { count: ids.length, sets: ids.sort() }]),
    ),
    sets: sets.map((set) => ({
      id: set.id,
      siteKey: set.siteKey,
      name: set.name,
      selectorCount: set.selectorCount,
      markerCount: set.markerCount,
      source: set.source,
      file: `sets/${sanitizeFileName(set.id)}.json`,
    })),
  };
  toJsonFile(storage.indexFile, index);

  return {
    ok: true,
    containerLibraryRoot,
    userContainerRoot: boot.root,
    copiedEntries: boot.copiedEntries,
    subscriptionRoot: storage.subscriptionRoot,
    setCount: sets.length,
    siteCount: Object.keys(bySite).length,
    index: storage.indexFile,
  };
}

export function listSubscriptionSets(options = {}) {
  const storage = resolveStoragePaths(options);
  const index = readJsonFile(storage.indexFile, null);
  if (!index?.sets) {
    throw new Error('Subscription index not found. Run: camo container init');
  }
  const site = options.site ? String(options.site).toLowerCase() : null;
  const sets = site
    ? index.sets.filter((item) => String(item.siteKey).toLowerCase() === site)
    : index.sets;
  return { ok: true, site, count: sets.length, sets };
}

function loadSubscriptionSetById(setId, options = {}) {
  const storage = resolveStoragePaths(options);
  const filePath = path.join(storage.setsDir, `${sanitizeFileName(setId)}.json`);
  return readJsonFile(filePath, null);
}

function readTargetsDoc(options = {}) {
  const storage = resolveStoragePaths(options);
  return readJsonFile(storage.targetsFile, {
    version: 1,
    updatedAt: null,
    profiles: {},
  });
}

export function registerSubscriptionTargets(profileId, setIds, options = {}) {
  if (!profileId || typeof profileId !== 'string') {
    throw new Error('profileId is required');
  }
  if (!Array.isArray(setIds) || setIds.length === 0) {
    throw new Error('at least one setId is required');
  }

  const storage = resolveStoragePaths(options);
  const doc = readTargetsDoc(options);
  const existing = doc.profiles[profileId] || { setIds: [], targets: [] };
  const resolvedSetIds = options.append ? new Set(existing.setIds || []) : new Set();
  for (const id of setIds) {
    resolvedSetIds.add(id);
  }

  const missingSetIds = [];
  const targets = [];
  for (const id of Array.from(resolvedSetIds)) {
    const setDef = loadSubscriptionSetById(id, options);
    if (!setDef) {
      missingSetIds.push(id);
      continue;
    }
    const markerDefs = Array.isArray(setDef.markers) ? setDef.markers : [];
    for (const marker of markerDefs) {
      if (!marker || typeof marker !== 'object') continue;
      targets.push({
        setId: setDef.id,
        siteKey: setDef.siteKey,
        markerType: marker.markerType || 'path',
        containerId: setDef.id,
        containerPath: marker.containerPath || null,
        urlPatterns: Array.isArray(marker.urlPatterns) ? marker.urlPatterns : [],
        dom: marker.dom || null,
      });
    }
  }

  const dedup = new Map();
  for (const item of targets) {
    const key = item.markerType === 'path'
      ? `path::${item.containerPath || ''}::${item.containerId}`
      : `url_dom::${item.containerId}::${item.dom?.css || ''}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }

  const allTargets = Array.from(dedup.values());
  const selectors = allTargets
    .filter((item) => item.markerType === 'url_dom' && item.dom?.css)
    .map((item) => ({
      setId: item.setId,
      siteKey: item.siteKey,
      css: item.dom.css,
      variant: item.dom?.variant || null,
    }));

  doc.profiles[profileId] = {
    setIds: Array.from(resolvedSetIds).sort(),
    targets: allTargets,
    selectors,
    updatedAt: new Date().toISOString(),
  };
  doc.updatedAt = new Date().toISOString();
  toJsonFile(storage.targetsFile, doc);

  return {
    ok: true,
    profileId,
    setCount: doc.profiles[profileId].setIds.length,
    targetCount: doc.profiles[profileId].targets.length,
    selectorCount: doc.profiles[profileId].selectors.length,
    missingSetIds,
    path: storage.targetsFile,
  };
}

export function getRegisteredTargets(profileId, options = {}) {
  const storage = resolveStoragePaths(options);
  const doc = readTargetsDoc(options);
  if (profileId) {
    const profile = doc.profiles[profileId] || null;
    return {
      ok: true,
      profileId,
      profile,
      path: storage.targetsFile,
    };
  }
  return {
    ok: true,
    profiles: doc.profiles,
    path: storage.targetsFile,
  };
}
