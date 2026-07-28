// Tab pool. Single truth_owner for resource_id=tab_pool.
//
// In-process slot pool per session/profileId. One page slot is "current"
// at any time. Slots are created on first use and reused until the
// session closes.
//
// Hard guards:
//   - One current slot per (profileId).
//   - next() advances strictly serial; no concurrent advance allowed.
//   - No v1 fallback to operations/tab-pool.mjs.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const ALLOWED_SLOT_STATUS = new Set(['idle', 'active', 'closed']);

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'tab_pool.write', reason: 'manager not in writable scope' } });
  }
}
// Read-only entry paths (list/current) are always available; reads
// never throw on enable gate.

const _pools = new Map();   // profileId -> { slots: [], current: number|null }

function nowIso() { return new Date().toISOString(); }

function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

function getPool(profileId) {
  const pid = safeId(profileId, 'profileId');
  let p = _pools.get(pid);
  if (!p) {
    p = { slots: [], current: null };
    _pools.set(pid, p);
  }
  return p;
}

export function ensureSlot(profileId, slotId) {
  ensureWritable();
  const pool = getPool(profileId);
  const sid = safeId(slotId, 'slotId');
  let slot = pool.slots.find((s) => s.slotId === sid);
  if (slot) return slot;
  slot = {
    slotId: sid,
    status: 'idle',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  pool.slots.push(slot);
  return slot;
}

export function setSlot(profileId, slotId, opts = {}) {
  ensureWritable();
  const pool = getPool(profileId);
  const sid = safeId(slotId, 'slotId');
  let slot = pool.slots.find((s) => s.slotId === sid);
  if (!slot) {
    slot = { slotId: sid, status: 'idle', createdAt: nowIso(), updatedAt: nowIso() };
    pool.slots.push(slot);
  }
  const status = String(opts.status || slot.status || 'idle');
  if (!ALLOWED_SLOT_STATUS.has(status)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'status', value: opts.status, allowed: [...ALLOWED_SLOT_STATUS] } });
  }
  slot.status = status;
  slot.updatedAt = nowIso();
  if (opts.setCurrent === true) {
    pool.current = pool.slots.indexOf(slot);
  }
  return slot;
}

export function next(profileId) {
  ensureWritable();
  const pool = getPool(profileId);
  if (pool.current == null) {
    if (pool.slots.length === 0) {
      // Lazily create slot 0.
      const slot = { slotId: 'tab-0', status: 'idle', createdAt: nowIso(), updatedAt: nowIso() };
      pool.slots.push(slot);
    }
    pool.current = 0;
  } else {
    pool.current = (pool.current + 1) % pool.slots.length;
  }
  const cur = pool.slots[pool.current];
  cur.status = 'active';
  cur.updatedAt = nowIso();
  return cur;
}

export function current(profileId) {
  const pool = _pools.get(safeId(profileId, 'profileId'));
  if (!pool || pool.current == null) return null;
  return pool.slots[pool.current];
}

export function list(profileId) {
  const pool = _pools.get(safeId(profileId, 'profileId'));
  if (!pool) return [];
  return pool.slots.slice();
}

export function closeAll(profileId) {
  ensureWritable();
  const pool = getPool(profileId);
  for (const s of pool.slots) {
    s.status = 'closed';
    s.updatedAt = nowIso();
  }
  pool.current = null;
  return pool.slots.length;
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _pools.clear();
}
