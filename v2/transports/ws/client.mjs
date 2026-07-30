// camo v2 WebSocket client. Module id=transports.ws (counterpart to server.mjs).
//
// L4/CLI side: builds a v1 envelope and dispatches a single command,
// awaits the matching id, returns the unwrapped payload. The actual
// socket transport is injected via `transport.sendFrame` so this
// module stays pure (and is unit-testable with a fake transport).
//
// Connection lifecycle:
//   - State machine: connecting -> connected -> disconnecting -> disconnected
//   - Heartbeat: ping/pong every 30s to detect dead connections
//   - Reconnection: exponential backoff (100ms base, 5s max, 8 attempts)
//
// Hard guards:
//   - No JSON.stringify of an envelope inline; always use build().
//   - No retry on send failure - E_IO_DISCONNECT is thrown.
//   - Heartbeat failures trigger disconnect event, not error.

import crypto from 'node:crypto';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { build as buildEnvelope } from '../../contracts/ws_messages/v1/envelope.mjs';
import { project as projectError } from '../../contracts/error_envelope/projector.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }

// --- Constants ---
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 5_000;
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_JITTER = 0.3;  // +/- 30% randomization

// --- State machine ---
const STATES = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
});

function assertState(expected, actual) {
  if (actual !== expected) {
    throw new CamoError({
      code: 'E_STATE_INVALID',
      details: { op: 'ws.client', expected, actual, reason: `operation requires ${expected}` },
    });
  }
}

function genId() {
  return `cli-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

const ALLOWED_KINDS = new Set(['hello', 'ready', 'command', 'result', 'event', 'error', 'ping', 'pong']);

function assertKind(kind) {
  if (!ALLOWED_KINDS.has(String(kind || ''))) {
    throw new CamoError({ code: 'E_PROTO_BAD_ENVELOPE', details: { field: 'kind', value: kind } });
  }
}

// --- Connection class with state machine + heartbeat + reconnect ---
export class Connection {
  /**
   * @param {string} url - WebSocket URL
   * @param {Object} opts
   * @param {number} opts.reconnectMaxAttempts - Max reconnect attempts (default 8, 0 to disable)
   * @param {number} opts.heartbeatIntervalMs - Heartbeat interval (default 30s, 0 to disable)
   */
  constructor(url, opts = {}) {
    if (!url || typeof url !== 'string') {
      throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url' } });
    }
    this._url = url;
    this._opts = {
      reconnectMaxAttempts: opts.reconnectMaxAttempts ?? RECONNECT_MAX_ATTEMPTS,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    };
    this._state = STATES.DISCONNECTED;
    this._ws = null;
    this._pending = new Map();  // correlationId -> { resolve, reject, timeout }
    this._heartbeatTimer = null;
    this._heartbeatTimeoutTimer = null;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._destroyed = false;
    this._listeners = { open: [], close: [], error: [], message: [] };
  }

  get state() { return this._state; }

  on(event, handler) {
    if (this._listeners[event]) this._listeners[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    }
    return this;
  }

  _emit(event, ...args) {
    for (const h of this._listeners[event] || []) h(...args);
  }

  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    this._emit('state', s);
  }

  async connect() {
    if (this._destroyed) throw new CamoError({ code: 'E_STATE_INVALID', details: { op: 'connect', reason: 'connection destroyed' } });
    if (this._state === STATES.CONNECTED || this._state === STATES.CONNECTING) return;

    assertState(STATES.DISCONNECTED, this._state);
    this._setState(STATES.CONNECTING);

    const { WebSocket } = await import('ws');
    this._ws = new WebSocket(this._url);

    this._ws.onopen = () => {
      this._reconnectAttempts = 0;
      this._setState(STATES.CONNECTED);
      this._emit('open');
      if (this._opts.heartbeatIntervalMs > 0) this._startHeartbeat();
    };

    this._ws.onmessage = (ev) => {
      let env;
      try { env = JSON.parse(String(ev.data)); }
      catch (cause) {
        this._emit('error', new CamoError({
          code: 'E_PROTO_BAD_ENVELOPE',
          details: { op: 'ws.client.onmessage', reason: cause?.message || String(cause) },
          cause,
        }));
        return;
      }
      // Handle pong (heartbeat response)
      if (env.kind === 'pong') {
        this._clearHeartbeatTimeout();
        return;
      }
      // Dispatch by correlation id
      if (env.id && this._pending.has(env.id)) {
        const pending = this._pending.get(env.id);
        clearTimeout(pending.timeout);
        this._pending.delete(env.id);
        pending.resolve(env);
        return;
      }
      // Emit for external listeners
      this._emit('message', env);
    };

    this._ws.onerror = (ev) => {
      this._emit('error', new CamoError({ code: 'E_IO_CONNECT', details: { op: 'ws.client', url: this._url, raw: ev?.message || null } }));
    };

    this._ws.onclose = (ev) => {
      this._stopHeartbeat();
      this._setState(STATES.DISCONNECTED);
      const code = ev?.code || 1000;
      this._emit('close', { code, reason: ev?.reason || null });
      // Reject pending
      for (const [id, p] of this._pending) {
        clearTimeout(p.timeout);
        p.reject(new CamoError({ code: 'E_IO_DISCONNECT', details: { op: 'ws.client', correlationId: id, code } }));
      }
      this._pending.clear();
      // Attempt reconnect if not intentionally closed and not destroyed
      if (!this._destroyed && code !== 1000 && this._reconnectAttempts < this._opts.reconnectMaxAttempts) {
        this._scheduleReconnect();
      } else if (this._destroyed) {
        this._ws = null;
      }
    };

    return new Promise((resolve, reject) => {
      this._ws.on('open', () => resolve());
      this._ws.on('error', (e) => reject(e));
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._state !== STATES.CONNECTED || !this._ws || this._ws.readyState !== 1) return;
      // Send ping
      try {
        const env = buildEnvelope({ kind: 'ping', payload: { ts: Date.now() } });
        this._ws.send(JSON.stringify(env));
        // Set timeout for pong response
        this._heartbeatTimeoutTimer = setTimeout(() => {
          // No pong received - connection is dead, close it
          this._ws.terminate();
          this._emit('error', new CamoError({
            code: 'E_BROWSER_HEARTBEAT',
            details: { op: 'ws.client.heartbeat', reason: 'pong timeout' },
          }));
        }, HEARTBEAT_TIMEOUT_MS);
      } catch (cause) {
        this._emit('error', new CamoError({
          code: 'E_IO_DISCONNECT',
          details: { op: 'ws.client.heartbeat.send', reason: cause?.message || String(cause) },
          cause,
        }));
      }
    }, this._opts.heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._heartbeatTimeoutTimer) { clearTimeout(this._heartbeatTimeoutTimer); this._heartbeatTimeoutTimer = null; }
  }

  _clearHeartbeatTimeout() {
    if (this._heartbeatTimeoutTimer) { clearTimeout(this._heartbeatTimeoutTimer); this._heartbeatTimeoutTimer = null; }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts), RECONNECT_MAX_MS);
    const jitter = delay * RECONNECT_JITTER * (Math.random() * 2 - 1);
    const actualDelay = Math.max(0, Math.round(delay + jitter));
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
      } catch (cause) {
        this._emit('error', new CamoError({
          code: 'E_IO_CONNECT',
          details: { op: 'ws.client.reconnect', reason: cause?.message || String(cause) },
          cause,
        }));
      }
    }, actualDelay);
  }

  /**
   * Send a command and wait for response.
   */
  async sendCommand({ kind = 'command', payload, id, timeoutMs = 60_000 } = {}) {
    if (this._state !== STATES.CONNECTED) {
      throw new CamoError({ code: 'E_STATE_INVALID', details: { op: 'sendCommand', state: this._state, reason: 'must be connected' } });
    }
    assertKind(kind);
    const correlationId = String(id || genId());
    const envelope = buildEnvelope({ id: correlationId, kind, payload: payload ?? null });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(correlationId);
        reject(new CamoError({ code: 'E_IO_TIMEOUT', details: { op: 'sendCommand', correlationId, timeoutMs } }));
      }, timeoutMs);

      this._pending.set(correlationId, { resolve, reject, timeout });

      try {
        this._ws.send(JSON.stringify(envelope));
      } catch (cause) {
        clearTimeout(timeout);
        this._pending.delete(correlationId);
        reject(new CamoError({ code: 'E_IO_DISCONNECT', details: { op: 'ws.client.send', correlationId }, cause }));
      }
    });
  }

  /**
   * Disconnect gracefully.
   */
  async disconnect() {
    if (this._state === STATES.DISCONNECTED || this._destroyed) return;
    this._setState(STATES.DISCONNECTING);
    this._destroyed = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) {
      this._ws.close(1000, 'client disconnect');
      this._ws = null;
    }
    this._setState(STATES.DISCONNECTED);
  }

  destroy() {
    this._destroyed = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    for (const [id, p] of this._pending) {
      clearTimeout(p.timeout);
      p.reject(new CamoError({ code: 'E_STATE_INVALID', details: { op: 'destroy', reason: 'connection destroyed' } }));
    }
    this._pending.clear();
    if (this._ws) { this._ws.terminate(); this._ws = null; }
    this._setState(STATES.DISCONNECTED);
  }
}

// --- Legacy single-shot API (preserved for backward compatibility) ---
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
