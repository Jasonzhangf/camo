// camo v2 WebSocket server. Module id=transports.ws.
//
// Single owner of the WS transport boundary. Every inbound frame must
// pass through contracts/ws_messages/v1/envelope.mjs::parse; every
// outbound frame must pass through build(). Ad-hoc JSON is forbidden
// by hard guard (policy type-lock+versioned).
//
// Hard guards:
//   - No raw socket.write(...) anywhere outside this module.
//   - handler(...).result is wrapped via build() before send.
//   - On unknown kind/parse error we send a single envelope {kind:error}
//     with the projected error. The caller owns the actual socket;
//     the daemon layer (stage 5) wires the real ws.Server up.
//   - The dispatcher is a registry of {kind -> async (env, ctx) => env}
//     injected by the daemon / by tests via registerHandler.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { build as buildEnvelope, parse as parseEnvelope, envelopeVersion } from '../../contracts/ws_messages/v1/envelope.mjs';
import { project as projectError } from '../../contracts/error_envelope/projector.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'ws.server.write', reason: 'not in writable scope' } });
  }
}

const ALLOWED_KINDS = new Set(['hello', 'ready', 'command', 'result', 'event', 'error', 'ping', 'pong']);

function ensureKind(kind) {
  if (!ALLOWED_KINDS.has(String(kind || ''))) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'kind', value: kind } });
  }
}

let _routes = Object.create(null);
let _sockets = [];

export function resetRoutes() {
  ensureWritable();
  _routes = Object.create(null);
  _sockets = [];
}

function nowIso() { return new Date().toISOString(); }

export function registerHandler(kind, fn) {
  ensureWritable();
  ensureKind(kind);
  if (typeof fn !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'fn', reason: 'must be a function' } });
  }
  if (_routes[kind]) {
    throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'ws.route', kind } });
  }
  _routes[kind] = fn;
  return kind;
}

export function hasHandler(kind) {
  return Boolean(_routes[String(kind || '')]);
}

export function listHandlers() {
  return Object.keys(_routes).sort();
}

export async function handleFrame({ text, send } = {}) {
  ensureWritable();
  let env;
  try {
    env = parseEnvelope(String(text ?? ''));
  } catch (cause) {
    const projected = projectError(cause);
    const err = buildEnvelope({
      id: 'srv-err',
      kind: 'error',
      payload: { code: projected.code, message: projected.message, details: projected.details },
    });
    send(err);
    return { ok: false, sent: [err] };
  }

  const route = _routes[env.kind];
  if (!route) {
    const ce = new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { kind: env.kind } });
    const projected = projectError(ce);
    const err = buildEnvelope({
      id: env.id,
      kind: 'error',
      payload: { code: projected.code, message: projected.message, details: projected.details },
    });
    send(err);
    return { ok: false, sent: [err] };
  }

  try {
    const out = await route(env, { serverVersion: envelopeVersion() });
    if (!out || typeof out !== 'object') {
      throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'ws.handler', kind: env.kind, reason: 'handler returned non-object' } });
    }
    const result = buildEnvelope({ id: env.id, kind: out.kind || 'result', payload: out.payload ?? null });
    send(result);
    return { ok: true, sent: [result] };
  } catch (cause) {
    const projected = projectError(cause);
    const err = buildEnvelope({
      id: env.id,
      kind: 'error',
      payload: { code: projected.code, message: projected.message, details: projected.details },
    });
    send(err);
    return { ok: false, sent: [err] };
  }
}

export function registerSocket(socket) { _sockets.push(socket); return socket; }
export function listSockets() { return _sockets.slice(); }

export function broadcastEvent(payload) {
  ensureWritable();
  const env = buildEnvelope({
    id: `srv-${Date.now()}`,
    kind: 'event',
    payload: payload ?? null,
    ts: nowIso(),
  });
  for (const s of _sockets) {
    try {
      s.send?.(env);
    } catch (cause) {
      _sockets = _sockets.filter((x) => x !== s);
      const ce = new CamoError({ code: 'E_IO_DISCONNECT', details: { op: 'ws.broadcast' }, cause });
      throw ce;
    }
  }
  return env;
}

export function serverVersion() { return envelopeVersion(); }

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _routes = Object.create(null);
  _sockets = [];
}
