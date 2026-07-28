// camo v2 HTTP server. Module id=transports.http.
//
// The HTTP surface is intentionally thin: every request must use the
// http_messages/v1 envelope; every response must be built via
// buildResponse. The actual TCP listening happens in shell/daemon
// wiring; here we only handle the routing inside one request.
//
// Hard guards:
//   - No response.send(...)/res.end(raw). Always use buildResponse.
//   - Unknown route raises E_PROTO_BAD_ENVELOPE; we let the caller
//     decide the status (router returns the env, daemon writes 200).
//   - Status is bounded to [100..599] by buildResponse, not here.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { buildResponse, parseRequest, envelopeVersion } from '../../contracts/http_messages/v1/envelope.mjs';
import { project as projectError } from '../../contracts/error_envelope/projector.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'http.server.write', reason: 'not in writable scope' } });
  }
}

const ROUTES = new Map(); // path -> handler (env, ctx) -> Promise<{kind:'result'|'error', body, status}>

export function resetRoutes() { ROUTES.clear(); ensureWritable(); }

export function registerRoute(method, path, handler) {
  ensureWritable();
  if (!ROUTES.has(path)) ROUTES.set(path, new Map());
  const inner = ROUTES.get(path);
  if (inner.has(method)) {
    throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'http.route', method, path } });
  }
  if (typeof handler !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'handler', reason: 'must be function' } });
  }
  inner.set(method, handler);
  return { method, path };
}

export function listRoutes() {
  const out = [];
  for (const [path, by] of ROUTES.entries()) {
    for (const method of by.keys()) out.push({ method, path });
  }
  return out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

// handleRequest({text, headers}):
//   - parses via parseRequest (v1 envelope)
//   - dispatches to registered handler by (method, path)
//   - returns a v1 response envelope (callers serialize to JSON)
export async function handleRequest({ text, contentType } = {}) {
  ensureWritable();
  let env;
  try {
    env = parseRequest(String(text ?? ''));
  } catch (cause) {
    const projected = projectError(cause);
    return buildResponse({
      id: 'srv-err',
      kind: 'error',
      status: 400,
      body: { code: projected.code, message: projected.message, details: projected.details },
    });
  }
  const inner = ROUTES.get(env.path);
  const handler = inner ? inner.get(env.method) : null;
  if (typeof handler !== 'function') {
    const ce = new CamoError({
      code: 'E_PROTO_NO_HANDLER',
      details: { method: env.method, path: env.path },
    });
    const projected = projectError(ce);
    return buildResponse({
      id: env.id,
      kind: 'error',
      status: 404,
      body: { code: projected.code, message: projected.message, details: projected.details },
    });
  }
  try {
    const out = await handler(env, { serverVersion: envelopeVersion(), contentType });
    const kind = out?.kind || 'result';
    const status = Number.isInteger(out?.status) ? out.status : 200;
    const body = out?.body ?? null;
    return buildResponse({ id: env.id, kind, status, body });
  } catch (cause) {
    const projected = projectError(cause);
    return buildResponse({
      id: env.id,
      kind: 'error',
      status: projected.code === 'E_INPUT_INVALID' ? 400 : 500,
      body: { code: projected.code, message: projected.message, details: projected.details },
    });
  }
}

export function serverVersion() { return envelopeVersion(); }

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  ROUTES.clear();
}
