// camo v2 WebSocket client. Module id=transports.ws (counterpart to server.mjs).
//
// L4/CLI side: builds a v1 envelope and dispatches a single command,
// awaits the matching id, returns the unwrapped payload. The actual
// socket transport is injected via `transport.sendFrame` so this
// module stays pure (and is unit-testable with a fake transport).
//
// Hard guards:
//   - No JSON.stringify of an envelope inline; always use build().
//   - No retry / fallback. If the first send fails, the failure is
//     surfaced with E_IO_CONNECT or E_IO_DISCONNECT.

import crypto from 'node:crypto';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { build as buildEnvelope } from '../../contracts/ws_messages/v1/envelope.mjs';
import { project as projectError } from '../../contracts/error_envelope/projector.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }

function genId() {
  return `cli-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

const ALLOWED_KINDS = new Set(['hello', 'ready', 'command', 'result', 'event', 'error', 'ping', 'pong']);

function assertKind(kind) {
  if (!ALLOWED_KINDS.has(String(kind || ''))) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'kind', value: kind } });
  }
}

// sendCommand(transport, {kind:'command', payload:{cmd:'start', ...}})
//   transport is { sendFrame(env) => Promise<env_response> }
//   returns the result envelope's payload (already validated).
export async function sendCommand(transport, { kind, payload, id } = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport', reason: 'requires { sendFrame }' } });
  }
  assertKind(kind || 'command');
  const correlationId = String(id || genId());
  const envelope = buildEnvelope({
    id: correlationId,
    kind: kind || 'command',
    payload: payload ?? null,
  });
  const reply = await transport.sendFrame(envelope);
  if (!reply || typeof reply !== 'object') {
    throw new CamoError({ code: 'E_IO_DISCONNECT', details: { op: 'ws.client.send', reason: 'transport returned non-object' } });
  }
  if (reply.id !== correlationId) {
    throw new CamoError({
      code: 'E_PROTO_BAD_ENVELOPE',
      details: { field: 'id', reason: 'correlation mismatch', expected: correlationId, actual: reply.id },
    });
  }
  if (reply.kind === 'error') {
    const ce = reply.payload || {};
    throw new CamoError({ code: ce.code || 'E_INTERNAL_UNEXPECTED', details: ce.details || { message: ce.message } });
  }
  return reply;
}

// Convenience: open a single send/receive transaction against a real ws.
export async function callOnce({ url, kind, payload, socketImpl } = {}) {
  if (!url || typeof url !== 'string') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url' } });
  }
  const impl = socketImpl || (await import('ws')).WebSocket;
  return await new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new impl(url);
    } catch (cause) {
      const ce = new CamoError({ code: 'E_IO_CONNECT', details: { op: 'ws.client.connect', url }, cause });
      reject(ce);
      return;
    }
    ws.onopen = () => {
      const envelope = buildEnvelope({ kind: kind || 'command', payload: payload ?? null });
      ws.send(JSON.stringify(envelope));
    };
    ws.onmessage = (ev) => {
      try {
        const reply = JSON.parse(String(ev.data));
        ws.close();
        resolve(reply);
      } catch (cause) {
        ws.close();
        reject(new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { op: 'ws.client.parse' }, cause }));
      }
    };
    ws.onerror = (ev) => {
      const ce = new CamoError({ code: 'E_IO_CONNECT', details: { op: 'ws.client.connect', url } });
      const projected = projectError(ce);
      reject(new CamoError({ code: projected.code, details: { ...(projected.details || {}), raw: ev?.message || null } }));
    };
  });
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  // no per-test state
}
