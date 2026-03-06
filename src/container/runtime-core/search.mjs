import { buildSelectorCheck } from './utils.mjs';

function normalizeQuery(raw) {
  const text = String(raw || '').trim();
  if (!text) return { query: '', queryLower: '' };
  return { query: text, queryLower: text.toLowerCase() };
}

function normalizeDirection(raw) {
  const text = String(raw || 'down').trim().toLowerCase();
  if (text === 'up' || text === 'down' || text === 'both') return text;
  return 'down';
}

function normalizeLimit(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.max(1, Math.floor(num));
}

function normalizeRect(node) {
  const rect = node?.rect && typeof node.rect === 'object' ? node.rect : null;
  if (!rect) return null;
  const left = Number(rect.left ?? rect.x ?? 0);
  const top = Number(rect.top ?? rect.y ?? 0);
  const width = Number(rect.width ?? 0);
  const height = Number(rect.height ?? 0);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function computeCenter(rect) {
  if (!rect) return null;
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

function buildSearchText(node) {
  if (!node || typeof node !== 'object') return '';
  const parts = [];
  const snippet = typeof node.textSnippet === 'string' ? node.textSnippet : '';
  if (snippet) parts.push(snippet);
  const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : null;
  if (attrs) {
    const candidates = [
      attrs['aria-label'],
      attrs['aria-label'.toLowerCase()],
      attrs.title,
      attrs.alt,
      attrs.placeholder,
    ];
    for (const item of candidates) {
      const text = typeof item === 'string' ? item.trim() : '';
      if (text) parts.push(text);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function isPathWithin(path, parentPath) {
  const child = String(path || '').trim();
  const parent = String(parentPath || '').trim();
  if (!child || !parent) return false;
  return child === parent || child.startsWith(`${parent}/`);
}

function collectMatches(node, options, path = 'root', out = []) {
  if (!node) return out;
  const { queryLower, visibleOnly } = options;
  const visible = node.visible === true;
  if (visibleOnly && !visible) {
    return out;
  }
  {
    const searchText = buildSearchText(node);
    if (searchText && searchText.toLowerCase().includes(queryLower)) {
      out.push({ node, path, searchText });
    }
  }
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i += 1) {
      collectMatches(node.children[i], options, `${path}/${i}`, out);
    }
  }
  return out;
}

function sortMatches(matches, direction) {
  const sorted = [...matches].sort((a, b) => {
    const ra = normalizeRect(a.targetNode);
    const rb = normalizeRect(b.targetNode);
    const ta = ra ? ra.top : Number.POSITIVE_INFINITY;
    const tb = rb ? rb.top : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    const la = ra ? ra.left : Number.POSITIVE_INFINITY;
    const lb = rb ? rb.left : Number.POSITIVE_INFINITY;
    return la - lb;
  });
  if (direction === 'up') return sorted.reverse();
  return sorted;
}

function applyStartAfter(matches, startAfterPath) {
  if (!startAfterPath) return matches;
  const idx = matches.findIndex((item) => item.targetPath === startAfterPath || item.matchPath === startAfterPath);
  if (idx < 0) return matches;
  return matches.slice(idx + 1);
}

export function searchSnapshot(snapshot, rawOptions = {}) {
  const { query, queryLower } = normalizeQuery(rawOptions.query || rawOptions.keyword || rawOptions.text);
  if (!query) {
    return { ok: false, code: 'QUERY_REQUIRED', message: 'search requires query keyword', data: { query } };
  }
  const direction = normalizeDirection(rawOptions.direction || 'down');
  const limit = normalizeLimit(rawOptions.limit ?? rawOptions.maxResults ?? 1);
  const visibleOnly = rawOptions.visibleOnly !== false;
  const containerSelector = String(rawOptions.containerSelector || rawOptions.selector || '').trim() || null;
  const startAfterPath = String(rawOptions.startAfterPath || rawOptions.afterPath || '').trim() || null;

  const containerNodes = containerSelector
    ? buildSelectorCheck(snapshot, { css: containerSelector, visible: visibleOnly })
    : [];
  const containerPaths = containerNodes.map((node) => node.path).filter(Boolean);

  const matches = collectMatches(snapshot, { queryLower, visibleOnly }, 'root', []);
  const enriched = matches.map((match) => {
    let containerNode = null;
    let containerPath = null;
    if (containerPaths.length > 0) {
      for (const path of containerPaths) {
        if (isPathWithin(match.path, path)) {
          containerPath = path;
          break;
        }
      }
      if (containerPath) {
        containerNode = containerNodes.find((node) => node.path === containerPath) || null;
      }
    }
    const targetNode = containerNode || match.node;
    const rect = normalizeRect(targetNode);
    const center = computeCenter(rect);
    return {
      matchPath: match.path,
      targetPath: containerPath || match.path,
      targetNode,
      matchNode: match.node,
      containerPath,
      rect,
      center,
      searchText: match.searchText,
    };
  });

  const filtered = containerSelector
    ? enriched.filter((item) => item.containerPath)
    : enriched;
  const ordered = sortMatches(filtered, direction);
  const sliced = applyStartAfter(ordered, startAfterPath).slice(0, limit);
  const results = sliced.map((item) => ({
    matchPath: item.matchPath,
    targetPath: item.targetPath,
    containerPath: item.containerPath,
    rect: item.rect,
    center: item.center,
    text: item.searchText,
  }));
  const nextCursor = results.length > 0 ? results[results.length - 1].targetPath : startAfterPath;

  return {
    ok: true,
    code: 'SEARCH_OK',
    message: 'search done',
    data: {
      query,
      direction,
      limit,
      visibleOnly,
      containerSelector,
      totalMatches: filtered.length,
      returned: results.length,
      nextCursor,
      results,
    },
  };
}
