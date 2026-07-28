// camo v2 WS envelope — v1. Type-locked builder/parser.
//
// Wire format (JSON text frame):
//   {
//     "v":   "camo.v2.protocol/v1",
//     "id":  "<correlation id; uuid or any opaque string>",
//     "kind":<one of WS_KINDS>,
//     "ts":  "<ISO 8601 UTC>",
//     "payload": <kind-specific object or null>
//   }
//
// Hard guards:
//   - Only this module may build or parse a v1 WS envelope.
//   - Ad-hoc JSON is forbidden; everything must go through build/parse.
//   - Unknown kind / missing fields raise E_PROTO_BAD_ENVELOPE.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { VERSION, WS_KINDS } from '../../../protocol/versions/v1.mjs';

const ALLOWED_KINDS = new Set(Object.values(WS_KINDS));

function nowIso() { return new Date().toISOString(); }

function assertKind(kind) {
  const k = String(kind || '').trim();
  if (!ALLOWED_KINDS.has(k)) {
    throw new CamoError({
      code: 'E_PROTO_BAD_ENVELOPE',
      details: { field: 'kind', value: kind, allowed: [...ALLOWED_KINDS] },
    });
  }
  return k;
}

function assertId(id) {
  const v = String(id || '').trim();
  if (!v) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'id', reason: 'required' } });
  }
  if (v.length > 256) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'id', reason: 'too long (>256)' } });
  }
  return v;
}

export function build({ kind, id, payload, ts } = {}) {
  const envelope = {
    v: VERSION,
    id: assertId(id),
    kind: assertKind(kind),
    ts: typeof ts === 'string' && ts ? ts : nowIso(),
    payload: payload === undefined ? null : payload,
  };
  return envelope;
}

export function parse(text) {
  if (typeof text !== 'string') {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'text', reason: 'not a string' } });
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (cause) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'text', reason: 'json parse failed' }, cause });
  }
  if (!obj || typeof obj !== 'object') {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { reason: 'top-level not an object' } });
  }
  if (obj.v !== VERSION) {
    throw new CamoError({ code: 'E_PROTO_BAD_VERSION', details: { expected: VERSION, actual: obj.v } });
  }
  return build({
    kind: obj.kind,
    id: obj.id,
    payload: obj.payload,
    ts: obj.ts,
  });
}

export function envelopeVersion() { return VERSION; }
