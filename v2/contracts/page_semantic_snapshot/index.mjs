// Semantic page snapshot contract for camo.
//
// Default `camo snapshot` output is machine-readable semantic JSON. Raw HTML
// is only returned after an explicit `--raw-dom` request. Snapshot and node
// refs are bound to profile+document and are invalidated through the snapshot
// registry in v2/services/page_runtime/snapshot_registry.mjs.

import crypto from 'node:crypto';
import { CamoError } from '../error_envelope/projector.mjs';

export const SNAPSHOT_FORMAT = 'semantic-json';
export const RAW_DOM_FORMAT = 'raw-dom';
export const DEFAULT_SNAPSHOT_TTL_MS = 5 * 60_000;
export const DEFAULT_SNAPSHOT_CAPACITY = 1000;

export function safeProfileId(profileId, field = 'profileId') {
  const v = String(profileId || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

export function safeDocumentId(documentId, field = 'documentId') {
  const v = String(documentId || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  return v;
}

export function genSnapshotId() {
  return `snap_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function genRef(snapshotId, nodeKey) {
  return `ref:${snapshotId}:${nodeKey}`;
}

export function splitRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('ref:')) {
    throw new CamoError({
      code: 'E_SNAPSHOT_REF_INVALID',
      details: { field: 'ref', value: ref, reason: 'ref must start with ref:' },
    });
  }
  const parts = ref.split(':');
  if (parts.length !== 3 || !parts[1]) {
    throw new CamoError({
      code: 'E_SNAPSHOT_REF_INVALID',
      details: { field: 'ref', value: ref, reason: 'ref must be ref:<snapshotId>:<nodeKey>' },
    });
  }
  return { snapshotId: parts[1], nodeKey: parts[2] };
}

export function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'snapshot', reason: 'must be object' } });
  }
  const required = ['snapshotId', 'documentId', 'url', 'title', 'viewport', 'window', 'tree'];
  for (const key of required) {
    if (snapshot[key] === undefined || snapshot[key] === null) {
      throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: `snapshot.${key}` } });
    }
  }
  if (!snapshot.tree || !Array.isArray(snapshot.tree.nodes)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'snapshot.tree.nodes', reason: 'must be array' } });
  }
  for (const node of snapshot.tree.nodes) {
    for (const key of ['ref', 'role', 'visible', 'inViewport', 'bounds', 'state', 'actions']) {
      if (node[key] === undefined || node[key] === null || node[key] === '') {
        throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: `snapshot.tree.nodes.ref=${node.ref}.${key}` } });
      }
    }
    if (!Array.isArray(node.actions)) {
      throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: `snapshot.tree.nodes.ref=${node.ref}.actions`, reason: 'must be array' } });
    }
  }
  return snapshot;
}

export function stableLocatorFor(runtimeNode) {
  const el = runtimeNode.el;
  if (!el) return null;
  if (el.id) return `#${cssEscape(el.id)}`;
  if (el.getAttribute && el.getAttribute('data-testid')) return `${el.tagName.toLowerCase()}[data-testid="${cssEscape(el.getAttribute('data-testid'))}"]`;
  if (el.getAttribute && el.getAttribute('data-camo-locator')) return `[data-camo-locator="${cssEscape(el.getAttribute('data-camo-locator'))}"]`;
  const label = runtimeNode.nameText && typeof runtimeNode.nameText === 'string'
    ? runtimeNode.nameText.slice(0, 80)
    : '';
  const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${cssEscape(ariaLabel)}"]`;
  if (label && el.getAttribute && el.getAttribute('aria-labelledby')) {
    return `${el.tagName.toLowerCase()}[aria-labelledby="${cssEscape(el.getAttribute('aria-labelledby'))}"]`;
  }
  return null;
}

function cssEscape(value) {
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
      || (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit >= 0x0030 && firstCodeUnit <= 0x0039)) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (index === 0 && codeUnit === 0x002D && string.length === 1) {
      result += '\\-';
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
}
