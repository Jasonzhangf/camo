// Subscription registry. Single truth_owner for resource_id=subscription.
//
// In-process map of (profileId, query) -> subscription record. Each
// subscription is a container-match watcher: when the matcher reports
// a change in the matched set, the registry fans events to the WS
// transport via the upstream caller (services.browser_service).
//
// Hard guards:
//   - Only this module mutates the map.
//   - emit() must not throw; failed dispatches are recorded as
//     lastError but never surfaced as an exception to the caller.
//   - No v1 fallback to container/subscription-registry.mjs.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const ALLOWED_EVENTS = new Set(['appear', 'disappear', 'change', 'always']);

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'subscription.write', reason: 'manager not in writable scope' } });
  }
}

const _subs = new Map();   // id -> record
const _seq = { v: 0 };

function nowIso() { return new Date().toISOString(); }

function genId() {
  _seq.v += 1;
  return `sub_${Date.now().toString(36)}_${_seq.v.toString(36)}`;
}

function normalizeEvent(event) {
  const e = String(event || '').trim().toLowerCase();
  if (!ALLOWED_EVENTS.has(e)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'event', value: event, allowed: [...ALLOWED_EVENTS] } });
  }
  return e;
}

function normalizeQuery(query) {
  if (!query || typeof query !== 'object') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'query' } });
  }
  return { ...query };
}

export function register(profileId, query, opts = {}) {
  ensureWritable();
  const pid = String(profileId || '').trim();
  if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  const q = normalizeQuery(query);
  const event = normalizeEvent(opts.event || 'appear');
  const id = String(opts.id || genId());
  if (_subs.has(id)) {
    throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'subscription', id } });
  }
  const rec = {
    id,
    profileId: pid,
    query: q,
    event,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastFiredAt: null,
    lastError: null,
    fireCount: 0,
  };
  _subs.set(id, rec);
  return rec;
}

export function unregister(id) {
  ensureWritable();
  const sid = String(id || '').trim();
  if (!sid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'id' } });
  if (!_subs.has(sid)) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'subscription', id: sid } });
  }
  const rec = _subs.get(sid);
  _subs.delete(sid);
  return rec;
}

export function read(id) {
  const sid = String(id || '').trim();
  const rec = _subs.get(sid);
  if (!rec) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'subscription', id: sid } });
  }
  return rec;
}

export function tryRead(id) {
  return _subs.get(String(id || '').trim()) || null;
}

export function list(profileId) {
  const all = [..._subs.values()];
  if (profileId == null) return all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const pid = String(profileId).trim();
  return all.filter((s) => s.profileId === pid).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export function count() {
  return _subs.size;
}

// dispatchEvent is the only entry point for the matcher/transport to
// report a match outcome. It MUST NOT throw; any handler failure is
// captured on the subscription record.
export function dispatchEvent(id, evt) {
  const sid = String(id || '').trim();
  const rec = _subs.get(sid);
  if (!rec) return { dispatched: false, reason: 'not_found' };
  rec.firedCount = (rec.firedCount || 0) + 1;
  rec.lastFiredAt = nowIso();
  rec.updatedAt = rec.lastFiredAt;
  if (evt && Object.prototype.hasOwnProperty.call(evt, 'error')) {
    rec.lastError = String(evt.error);
  }
  return { dispatched: true, rec };
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _subs.clear();
  _seq.v = 0;
}
