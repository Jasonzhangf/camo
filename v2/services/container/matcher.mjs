// Container matcher. Single truth_owner for resource_id=container_match.
//
// Pure matcher fed state snapshots by the page runtime. The snapshot is
// a normalized description of visible DOM containers:
//   [{ id, role, text, visible, viewport?, x?, y?, width?, height? }, ...]
//
// Hard guards:
//   - Single algorithm owner (no duplicates in v2).
//   - Viewport filter is part of the algorithm; callers cannot disable it.
//   - No v1 fallback to search.mjs or container-matcher.js.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const ALLOWED_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'tab',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'item',
  'generic',
  'navigation',
  'main',
  'article',
  'banner',
  'contentinfo',
  'form',
  'list',
  'listitem',
  'heading',
  'img',
]);

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return null;
  if (!ALLOWED_ROLES.has(r)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'role', value: role, allowed: [...ALLOWED_ROLES] } });
  }
  return r;
}

function normalizeQuery(query) {
  if (!query || typeof query !== 'object') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'query' } });
  }
  const q = { ...query };
  if (q.id == null && q.role == null && q.text == null && q.within == null) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'query', reason: 'one of id/role/text/within is required' } });
  }
  if (q.role != null) q.role = normalizeRole(q.role);
  if (q.text != null) q.text = String(q.text);
  if (q.id != null) q.id = String(q.id);
  if (q.within != null) q.within = String(q.within);
  if (q.timeoutMs != null) {
    const t = Number(q.timeoutMs);
    if (!Number.isFinite(t) || t < 0) {
      throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'timeoutMs', value: q.timeoutMs } });
    }
    q.timeoutMs = t;
  }
  return q;
}

function normalizeSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'snapshot', reason: 'must be array' } });
  }
  return snapshot.map((c, idx) => {
    if (!c || typeof c !== 'object') {
      throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: `snapshot[${idx}]`, reason: 'not an object' } });
    }
    const visible = c.visible !== false;
    const vp = c.viewport && typeof c.viewport === 'object' ? c.viewport : null;
    const bounds = c.bounds && typeof c.bounds === 'object' ? c.bounds : {};
    let inViewport = c.inViewport !== false;
    if (vp && Number.isFinite(vp.width) && Number.isFinite(vp.height)) {
      const x = Number(c.x ?? bounds.x ?? 0);
      const y = Number(c.y ?? bounds.y ?? 0);
      const w = Number(c.width ?? bounds.width ?? 0);
      const h = Number(c.height ?? bounds.height ?? 0);
      inViewport = x + w > 0 && y + h > 0 && x < vp.width && y < vp.height;
    }
    return {
      id: c.id == null ? (c.ref == null ? null : String(c.ref)) : String(c.id),
      role: c.role == null ? null : String(c.role).toLowerCase(),
      text: c.text == null ? (c.nameText == null ? (c.name == null ? '' : String(c.name)) : String(c.nameText)) : String(c.text),
      ref: c.ref == null ? null : String(c.ref),
      nameText: c.nameText == null ? (c.name == null ? '' : String(c.name)) : String(c.nameText),
      stableLocator: c.stableLocator == null ? null : String(c.stableLocator),
      bounds: c.bounds && typeof c.bounds === 'object' ? c.bounds : null,
      visible,
      inViewport,
    };
  });
}

function scoreMatch(container, q) {
  if (q.id != null && container.id !== q.id) return 0;
  if (q.role != null && container.role !== q.role) return 0;
  if (q.text != null) {
    if (!container.text || !container.text.includes(q.text)) return 0;
  }
  if (q.within != null && container.id !== q.within) return 0;
  if (!container.visible) return 0;
  if (!container.inViewport) return 0;
  if (q.text != null && container.text === q.text) return 2;
  return 1;
}

function visibleCandidates(snapshot) {
  return snapshot.filter((c) => c.visible && c.inViewport);
}

export function match(query, snapshot) {
  const q = normalizeQuery(query);
  const items = normalizeSnapshot(snapshot);
  const ranked = items
    .map((c) => ({ c, score: scoreMatch(c, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    query: q,
    matched: ranked.map((r) => r.c),
    primary: ranked[0] ? ranked[0].c : null,
  };
}

export function inspect(query, snapshot) {
  const out = match(query, snapshot);
  return {
    query: out.query,
    primary: out.primary,
    matchedCount: out.matched.length,
    visibleTotal: visibleCandidates(normalizeSnapshot(snapshot)).length,
  };
}

export function visibleCount(snapshot) {
  return visibleCandidates(normalizeSnapshot(snapshot)).length;
}

export function __resetForTest() {
  // pure module; placeholder for future caching hooks.
}
