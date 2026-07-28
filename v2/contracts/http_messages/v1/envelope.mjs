// camo v2 HTTP envelope — v1. Type-locked builder/parser.
//
// Request envelope:
//   { "v": <version>, "id": <correlation>, "kind": <HTTP_KINDS>,
//     "method": "GET"|"POST"|..., "path": "/...", "body": <object|null> }
//
// Response envelope:
//   { "v": <version>, "id": <correlation>, "kind": "result"|"error",
//     "status": <int 100-599>, "body": <object|null> }
//
// Hard guards:
//   - Only this module may build or parse a v1 HTTP envelope.
//   - status out of range or method unknown raises E_PROTO_BAD_ENVELOPE.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { VERSION, HTTP_KINDS } from '../../../protocol/versions/v1.mjs';

const ALLOWED_REQUEST_KINDS = new Set([HTTP_KINDS.HEALTH, HTTP_KINDS.COMMAND]);
const ALLOWED_RESPONSE_KINDS = new Set([HTTP_KINDS.RESULT, HTTP_KINDS.ERROR]);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function assertId(id) {
  const v = String(id || '').trim();
  if (!v) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'id', reason: 'required' } });
  }
  return v;
}

function assertPath(p) {
  const v = String(p || '').trim();
  if (!v.startsWith('/')) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'path', reason: 'must start with /' } });
  }
  if (v.length > 2048) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'path', reason: 'too long' } });
  }
  return v;
}

function assertMethod(m) {
  const v = String(m || '').trim().toUpperCase();
  if (!ALLOWED_METHODS.has(v)) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'method', value: m, allowed: [...ALLOWED_METHODS] } });
  }
  return v;
}

function assertStatus(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 100 || n > 599) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'status', value: s } });
  }
  return n;
}

export function buildRequest({ id, kind, method, path, body } = {}) {
  const k = String(kind || '').trim();
  if (!ALLOWED_REQUEST_KINDS.has(k)) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'kind', value: kind, allowed: [...ALLOWED_REQUEST_KINDS] } });
  }
  return {
    v: VERSION,
    id: assertId(id),
    kind: k,
    method: assertMethod(method),
    path: assertPath(path),
    body: body === undefined ? null : body,
  };
}

export function buildResponse({ id, kind, status, body } = {}) {
  const k = String(kind || '').trim();
  if (!ALLOWED_RESPONSE_KINDS.has(k)) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'kind', value: kind, allowed: [...ALLOWED_RESPONSE_KINDS] } });
  }
  return {
    v: VERSION,
    id: assertId(id),
    kind: k,
    status: assertStatus(status),
    body: body === undefined ? null : body,
  };
}

function parseEnvelope(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { reason: 'top-level not an object' } });
  }
  if (obj.v !== VERSION) {
    throw new CamoError({ code: 'E_PROTO_BAD_VERSION', details: { expected: VERSION, actual: obj.v } });
  }
  return obj;
}

export function parseRequest(text) {
  if (typeof text !== 'string') {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'text', reason: 'not a string' } });
  }
  let obj;
  try { obj = JSON.parse(text); } catch (cause) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'text', reason: 'json parse failed' }, cause });
  }
  const env = parseEnvelope(obj);
  return buildRequest({
    id: env.id,
    kind: env.kind,
    method: env.method,
    path: env.path,
    body: env.body,
  });
}

export function parseResponse(text) {
  if (typeof text !== 'string') {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'text', reason: 'not a string' } });
  }
  let obj;
  try { obj = JSON.parse(text); } catch (cause) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'text', reason: 'json parse failed' }, cause });
  }
  const env = parseEnvelope(obj);
  return buildResponse({
    id: env.id,
    kind: env.kind,
    status: env.status,
    body: env.body,
  });
}

export function envelopeVersion() { return VERSION; }
