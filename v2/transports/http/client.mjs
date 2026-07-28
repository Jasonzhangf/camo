// camo v2 HTTP client. Module id=transports.http (counterpart to server.mjs).
//
// L4/CLI side: builds a v1 request envelope and dispatches it. The
// transport (a real fetch in production, a fake one in tests) is
// injected; this module only owns the contract.
//
// Hard guards:
//   - No JSON.stringify of an envelope inline; always use buildRequest.
//   - On non-2xx + kind=error, throw CamoError with the projected code.

import crypto from 'node:crypto';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { buildRequest } from '../../contracts/http_messages/v1/envelope.mjs';
import { project as projectError } from '../../contracts/error_envelope/projector.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }

function genId() {
  return `cli-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export async function sendRequest(transport, { id, method, path, body } = {}) {
  if (!transport || typeof transport.sendRequest !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport', reason: 'requires { sendRequest }' } });
  }
  const correlationId = String(id || genId());
  const env = buildRequest({
    id: correlationId,
    kind: path === '/health' ? 'health' : 'command',
    method,
    path,
    body: body ?? null,
  });
  const reply = await transport.sendRequest(env);
  if (!reply || typeof reply !== 'object') {
    throw new CamoError({ code: 'E_IO_DISCONNECT', details: { op: 'http.client.send' } });
  }
  if (reply.id !== correlationId) {
    throw new CamoError({
      code: 'E_PROTO_BAD_ENVELOPE',
      details: { field: 'id', reason: 'correlation mismatch', expected: correlationId, actual: reply.id },
    });
  }
  if (reply.kind === 'error') {
    const projected = projectError(new CamoError({ code: reply.body?.code || 'E_INTERNAL_UNEXPECTED', details: reply.body?.details }));
    throw new CamoError({ code: projected.code, details: projected.details });
  }
  return reply;
}

export async function fetchHealth({ url } = {}) {
  if (!url || typeof url !== 'string') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url' } });
  }
  const env = buildRequest({ method: 'GET', path: '/health', body: null });
  const text = await fetch(url, {
    method: env.method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(env),
  }).then(async (r) => {
    return await r.text();
  });
  // Use parseResponse implicitly via sendRequest shape; here we hand-parse.
  const obj = JSON.parse(text);
  if (obj.kind === 'error') {
    throw new CamoError({ code: obj.body?.code || 'E_INTERNAL_UNEXPECTED', details: obj.body?.details });
  }
  return obj;
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
}
