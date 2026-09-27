// Semantic snapshot capture for page_runtime.
//
// `camo snapshot` returns machine-readable semantic JSON by default. Raw HTML
// is only produced when `rawDom` is explicitly requested. If the page binding
// cannot supply semantic data, the operation fails with a typed capability
// error instead of falling back to HTML or a screenshot.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import {
  safeProfileId,
  safeDocumentId,
  genSnapshotId,
  genRef,
  SNAPSHOT_FORMAT,
  RAW_DOM_FORMAT,
  DEFAULT_SNAPSHOT_TTL_MS,
} from '../../contracts/page_semantic_snapshot/index.mjs';
import { register as registerSnapshot } from './snapshot_registry.mjs';
import { getTargetPageOrThrow, emit } from './operations/_page_helpers.mjs';

const EXTRACTION = function extractSemanticSnapshot() {
  // Probe the actual semantic surface, not merely the presence of evaluate().
  // This adapter uses DOM+ARIA inference, not a native accessibility tree.
  if (typeof document === 'undefined' || typeof window === 'undefined'
    || typeof getComputedStyle !== 'function'
    || typeof document.getElementById !== 'function'
    || typeof document.documentElement?.querySelectorAll !== 'function'
    || typeof document.documentElement?.getAttribute !== 'function'
    || typeof document.documentElement?.getBoundingClientRect !== 'function') return null;
  const doc = document;
  const root = doc.documentElement;
  const viewport = {
    width: window.innerWidth || root.clientWidth || 0,
    height: window.innerHeight || root.clientHeight || 0,
    dpr: window.devicePixelRatio || 1,
    scrollX: Math.round(window.scrollX || 0),
    scrollY: Math.round(window.scrollY || 0),
  };
  const windowInfo = {
    innerWidth: window.innerWidth || 0,
    innerHeight: window.innerHeight || 0,
    outerWidth: window.outerWidth || 0,
    outerHeight: window.outerHeight || 0,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  const selector = [
    '[role]',
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    'nav',
    'main',
    'article',
    'header',
    'footer',
    'form',
    'ul',
    'ol',
    'li',
    'h1, h2, h3, h4, h5, h6',
    'img[alt]',
  ].join(',');

  const inferRole = (el, tag) => {
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'article') return 'article';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'form') return 'form';
    if (tag === 'li') return 'listitem';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    return 'generic';
  };

  const accessibleName = (el) => {
    const label = el.getAttribute && el.getAttribute('aria-label');
    if (label && String(label).trim()) return String(label).trim().slice(0, 160);
    if (el.getAttribute && el.getAttribute('aria-labelledby')) {
      const ids = el.getAttribute('aria-labelledby').split(/\s+/);
      const parts = [];
      for (const id of ids) {
        const node = doc.getElementById(id);
        if (node && node.textContent) parts.push(node.textContent.trim());
      }
      if (parts.length) return parts.join(' ').slice(0, 160);
    }
    if (el.tagName === 'INPUT') {
      if (el.getAttribute && el.getAttribute('placeholder')) return String(el.getAttribute('placeholder')).trim().slice(0, 160);
      return '';
    }
    if (el.tagName === 'IMG') return String(el.getAttribute && (el.getAttribute('alt') || '') || '').trim().slice(0, 160);
    const text = (el.textContent || '').trim();
    if (text) return text.slice(0, 160);
    return '';
  };

  const deriveState = (el) => {
    const state = {};
    if (el.disabled !== undefined) state.disabled = Boolean(el.disabled);
    if (el.checked !== undefined) state.checked = Boolean(el.checked);
    if (el.selected !== undefined) state.selected = Boolean(el.selected);
    if (el.getAttribute && el.getAttribute('aria-expanded') != null) {
      state.expanded = el.getAttribute('aria-expanded') === 'true';
    }
    if (el.getAttribute && el.getAttribute('aria-pressed') != null) {
      state.pressed = el.getAttribute('aria-pressed') === 'true';
    }
    return state;
  };

  const deriveActions = (role) => {
    if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio' || role === 'tab') return ['click'];
    if (role === 'textbox') return ['type'];
    if (role === 'combobox' || role === 'listbox') return ['select'];
    return [];
  };

  const cssEscape = (value) => {
    const string = String(value ?? '');
    let result = '';
    const firstCodeUnit = string.charCodeAt(0);
    for (let index = 0; index < string.length; index += 1) {
      const codeUnit = string.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += '\uFFFD';
        continue;
      }
      if ((codeUnit >= 0x0001 && codeUnit <= 0x001F)
        || (codeUnit >= 0x007F && codeUnit <= 0x009F)
        || (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039)
        || (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002D)) {
        result += `\\${codeUnit.toString(16)} `;
        continue;
      }
      if (index === 0 && codeUnit === 0x002D && (string.length === 1 || (string.charCodeAt(1) >= 0x0030 && string.charCodeAt(1) <= 0x0039))) {
        result += `\\${codeUnit.toString(16)} `;
        continue;
      }
      if (codeUnit >= 0x0080 || codeUnit === 0x002D || codeUnit === 0x005F
        || (codeUnit >= 0x0030 && codeUnit <= 0x0039)
        || (codeUnit >= 0x0041 && codeUnit <= 0x005A)
        || (codeUnit >= 0x0061 && codeUnit <= 0x007A)) {
        result += string.charAt(index);
        continue;
      }
      result += `\\${string.charAt(index)}`;
    }
    return result;
  };

  const stableLocator = (el, tag, role, name) => {
    if (el.id) return `#${cssEscape(el.id)}`;
    if (el.getAttribute && el.getAttribute('data-testid')) return `${tag}[data-testid="${cssEscape(el.getAttribute('data-testid'))}"]`;
    if (el.getAttribute && el.getAttribute('aria-label')) return `${tag}[aria-label="${cssEscape(el.getAttribute('aria-label'))}"]`;
    // A bare role selector is not a stable, unique locator. Returning it would
    // make a later action target the wrong node or fail as ambiguous; callers
    // should resolve by snapshot ref or by the node's accessible text instead.
    return null;
  };

  const nodes = [];
  const seen = new Set();
  const elements = Array.from(root.querySelectorAll(selector));
  for (let index = 0; index < elements.length; index += 1) {
    const el = elements[index];
    const tag = el.tagName.toLowerCase();
    const roleAttr = String(el.getAttribute && (el.getAttribute('role') || '') || '').trim().toLowerCase();
    const role = roleAttr || inferRole(el, tag);
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    const inViewport = visible && rect.left < viewport.width && rect.top < viewport.height && rect.right > 0 && rect.bottom > 0;
    const nameText = accessibleName(el);
    const stable = stableLocator(el, tag, role, nameText);
    const key = `${tag}:${role}:${stable}:${nameText}:${Math.round(rect.x)}:${Math.round(rect.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push({
      id: el.id || null,
      ref: null,
      role,
      nameText,
      visible,
      inViewport,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      state: deriveState(el),
      actions: deriveActions(role),
      stableLocator: stable,
    });
  }
  return {
    capabilities: { semantic: 'dom-aria', nativeAccessibility: false },
    title: doc.title || '',
    url: window.location.href || '',
    viewport,
    window: windowInfo,
    nodes,
  };
};

export async function captureSemanticSnapshot({ profileId, target, rawDom = false, ttlMs = DEFAULT_SNAPSHOT_TTL_MS }) {
  const pid = safeProfileId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const documentId = safeDocumentId(target.documentId || target.pageId || `doc_${pid}_${Date.now()}`, 'documentId');
  emit(pid, 'snapshot.start', { rawDom, documentId });
  try {
    if (rawDom === true) {
      const content = await page.content();
      const result = {
        profileId: pid,
        targetId: target.targetId,
        snapshot: true,
        format: RAW_DOM_FORMAT,
        rawDom: true,
        documentId,
        url: page.url(),
        htmlLength: content.length,
        html: content,
      };
      emit(pid, 'snapshot.done', { format: RAW_DOM_FORMAT, htmlLength: content.length });
      return result;
    }

    if (typeof page.evaluate !== 'function') {
      throw new CamoError({
        code: 'E_SNAPSHOT_CAPABILITY_MISSING',
        details: { profileId: pid, targetId: target.targetId, reason: 'page binding has no evaluate capability for semantic extraction' },
      });
    }

    let semantic;
    try {
      semantic = await page.evaluate(EXTRACTION);
    } catch (cause) {
      throw new CamoError({
        code: 'E_SNAPSHOT_CAPABILITY_MISSING',
        details: { profileId: pid, targetId: target.targetId, reason: cause?.message || String(cause) },
        cause,
      });
    }

    if (semantic?.capabilities?.semantic !== 'dom-aria' || !Array.isArray(semantic.nodes)) {
      throw new CamoError({
        code: 'E_SNAPSHOT_CAPABILITY_MISSING',
        details: { profileId: pid, targetId: target.targetId, reason: 'page binding has no stable DOM+ARIA semantic surface' },
      });
    }

    const snapshotId = genSnapshotId();
    const nodes = semantic.nodes.map((node, index) => ({
      ...node,
      ref: genRef(snapshotId, `n${index + 1}`),
      name: node.nameText,
    }));
    const snapshot = {
      snapshotId,
      profileId: pid,
      documentId,
      targetId: target.targetId,
      url: semantic.url || page.url(),
      title: semantic.title || '',
      viewport: semantic.viewport || { width: 0, height: 0 },
      window: semantic.window || {},
      capabilities: semantic.capabilities,
      tree: { nodes },
    };
    registerSnapshot({ snapshot, ttlMs });
    const result = {
      profileId: pid,
      targetId: target.targetId,
      snapshot: true,
      format: SNAPSHOT_FORMAT,
      snapshotId,
      documentId,
      url: snapshot.url,
      title: snapshot.title,
      viewport: snapshot.viewport,
      window: snapshot.window,
      capabilities: snapshot.capabilities,
      tree: snapshot.tree,
    };
    emit(pid, 'snapshot.done', { format: SNAPSHOT_FORMAT, snapshotId, nodes: nodes.length });
    return result;
  } catch (cause) {
    emit(pid, 'snapshot.error', { error: cause?.message || String(cause) });
    throw cause;
  }
}
