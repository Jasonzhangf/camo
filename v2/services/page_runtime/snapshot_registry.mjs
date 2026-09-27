// Snapshot registry for camo page_runtime.
//
// Holds semantic snapshots keyed by snapshotId and binds each snapshot to a
// profile+document identity. References become stale on navigation, tab close,
// session stop, TTL expiry, and capacity eviction. No silent fallback: a stale
// or ambiguous ref throws a typed CamoError.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { splitRef } from '../../contracts/page_semantic_snapshot/index.mjs';

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_CAPACITY = 1000;

let _snapshots = new Map();
let _nodeIndex = new Map();
let _generation = 0;

export function __resetForTest() {
  _snapshots = new Map();
  _nodeIndex = new Map();
  _generation = 0;
}

function nowIso() {
  return new Date().toISOString();
}

function assertWritableSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'snapshot', reason: 'must be object' } });
  }
  if (!snapshot.snapshotId || !snapshot.documentId || !snapshot.profileId) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'snapshot', reason: 'snapshotId/documentId/profileId required' } });
  }
}

export function register({ snapshot, ttlMs = DEFAULT_TTL_MS, capacity = DEFAULT_CAPACITY }) {
  assertWritableSnapshot(snapshot);
  const now = Date.now();
  if (_snapshots.size >= capacity) {
    const oldestKey = _snapshots.keys().next().value;
    if (oldestKey != null) removeSnapshot(oldestKey);
  }
  const record = {
    snapshotId: snapshot.snapshotId,
    profileId: snapshot.profileId,
    documentId: snapshot.documentId,
    targetId: snapshot.targetId || null,
    url: snapshot.url || null,
    createdAt: nowIso(),
    expiresAt: new Date(now + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS)).toISOString(),
    snapshot,
  };
  _snapshots.set(record.snapshotId, record);
  const nodes = Array.isArray(snapshot.tree?.nodes) ? snapshot.tree.nodes : [];
  for (const node of nodes) {
    if (!node.ref) continue;
    const key = `${record.profileId}:${record.documentId}:${node.ref}`;
    if (_nodeIndex.has(key)) {
      removeSnapshot(record.snapshotId);
      throw new CamoError({
        code: 'E_SNAPSHOT_AMBIGUOUS',
        details: { resource: 'snapshot_ref', profileId: record.profileId, documentId: record.documentId, ref: node.ref },
      });
    }
    _nodeIndex.set(key, { snapshotId: record.snapshotId, node });
  }
  _generation += 1;
  return record;
}

function removeSnapshot(snapshotId) {
  const record = _snapshots.get(snapshotId);
  if (!record) return null;
  for (const [key, entry] of _nodeIndex) {
    if (entry.snapshotId === snapshotId) _nodeIndex.delete(key);
  }
  _snapshots.delete(snapshotId);
  return record;
}

export function invalidateForProfile(profileId, reason = 'explicit') {
  for (const [snapshotId, record] of [..._snapshots]) {
    if (record.profileId === profileId) removeSnapshot(snapshotId);
  }
  return { profileId, invalidated: true, reason };
}

export function invalidateForDocument(profileId, documentId, reason = 'document_changed') {
  for (const [snapshotId, record] of [..._snapshots]) {
    if (record.profileId === profileId && record.documentId === documentId) removeSnapshot(snapshotId);
  }
  return { profileId, documentId, invalidated: true, reason };
}

export function lookupSnapshot(snapshotId, { profileId, documentId } = {}) {
  const rec = _snapshots.get(String(snapshotId || ''));
  if (!rec) {
    throw new CamoError({ code: 'E_SNAPSHOT_STALE', details: { resource: 'semantic_snapshot', snapshotId } });
  }
  if (Date.parse(rec.expiresAt) <= Date.now()) {
    removeSnapshot(rec.snapshotId);
    throw new CamoError({ code: 'E_SNAPSHOT_STALE', details: { resource: 'semantic_snapshot', snapshotId, reason: 'ttl_expired' } });
  }
  if (profileId && rec.profileId !== String(profileId)) {
    throw new CamoError({ code: 'E_SNAPSHOT_STALE', details: { resource: 'semantic_snapshot', snapshotId, reason: 'profile_mismatch' } });
  }
  if (documentId && rec.documentId !== String(documentId)) {
    throw new CamoError({ code: 'E_SNAPSHOT_STALE', details: { resource: 'semantic_snapshot', snapshotId, reason: 'document_mismatch' } });
  }
  return rec;
}

export function lookupNodeRef(ref, { profileId, documentId } = {}) {
  let parsed;
  try {
    parsed = splitRef(ref);
  } catch (cause) {
    throw cause;
  }
  const rec = lookupSnapshot(parsed.snapshotId, { profileId, documentId });
  const key = `${rec.profileId}:${rec.documentId}:${ref}`;
  const hit = _nodeIndex.get(key);
  if (!hit) {
    throw new CamoError({ code: 'E_SNAPSHOT_STALE', details: { resource: 'semantic_snapshot', snapshotId: parsed.snapshotId, ref } });
  }
  return { snapshotId: rec.snapshotId, documentId: rec.documentId, node: hit.node };
}

export function list() {
  return [..._snapshots.values()].map((r) => ({
    snapshotId: r.snapshotId,
    profileId: r.profileId,
    documentId: r.documentId,
    url: r.url,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  }));
}

export function generation() {
  return _generation;
}
