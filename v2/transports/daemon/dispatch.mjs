// camo v2 daemon dispatcher. Module id=transports.daemon.
//
// The daemon process owns the WS/HTTP sockets. This module glues:
//   - WS server (transports/ws/server.mjs)
//   - HTTP server (transports/http/server.mjs)
//   - progress_event fan-out (services/progress_event/log.mjs)
//
// In production, this is the binding surface; here we ship only the
// testable wiring hooks (register, route, drain, error projection).
// Hard guards:
//   - No business logic. This module only wires transports + progress.
//   - No fallback if a transport fails to attach; surface with E_IO_CONNECT.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { build as buildEnvelope } from '../../contracts/ws_messages/v1/envelope.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'daemon.write', reason: 'not in writable scope' } });
  }
}

let _wiring = null;

export function plan({ profileId, wsPort, httpPort } = {}) {
  ensureWritable();
  if (!profileId) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  _wiring = {
    profileId,
    ws: { port: wsPort || null, attached: false },
    http: { port: httpPort || null, attached: false },
    progress: { wired: false },
    createdAt: new Date().toISOString(),
  };
  return describe();
}

export function attach(name, port) {
  ensureWritable();
  if (!_wiring) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'daemon.wiring' } });
  }
  if (!['ws', 'http'].includes(String(name))) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'name', value: name } });
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'port', value: port } });
  }
  _wiring[name].port = port;
  _wiring[name].attached = true;
  return _wiring[name];
}

export function attachProgress() {
  ensureWritable();
  if (!_wiring) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'daemon.wiring' } });
  }
  _wiring.progress.wired = true;
  return _wiring.progress;
}

export function describe() {
  ensureWritable();
  if (!_wiring) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'daemon.wiring' } });
  }
  return JSON.parse(JSON.stringify(_wiring));
}

// fanOut: receive a progress event payload and emit a v1 ws envelope.
// No business semantics here — service_layer decides what to log.
export function fanOutEvent(payload) {
  ensureWritable();
  if (!_wiring || !_wiring.progress.wired) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'daemon.wiring.progress' } });
  }
  return buildEnvelope({
    id: `evt-${Date.now()}`,
    kind: 'event',
    payload: payload ?? null,
  });
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _wiring = null;
}
