import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __enableTestRoot,
  registerHandler,
  handleFrame,
  listHandlers,
  resetRoutes,
  broadcastEvent,
  registerSocket,
} from '../../../transports/ws/server.mjs';
import { build as buildEnvelope } from '../../../contracts/ws_messages/v1/envelope.mjs';

test('positive: registerHandler routes a command envelope to result', async () => {
  __enableTestRoot();
  resetRoutes();
  registerHandler('command', async (env) => ({ kind: 'result', payload: { cmd: env.payload?.cmd || null, echoed: true } }));
  const sent = [];
  const env = buildEnvelope({ kind: 'command', id: 'a1', payload: { cmd: 'start' } });
  const out = await handleFrame({ text: JSON.stringify(env), send: (e) => sent.push(e) });
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'result');
  assert.equal(sent[0].id, 'a1');
  assert.equal(sent[0].payload.cmd, 'start');
  assert.equal(sent[0].payload.echoed, true);
});

test('negative: valid kind with no handler returns E_PROTO_NO_HANDLER', async () => {
  __enableTestRoot();
  resetRoutes();
  registerHandler('command', async () => ({ kind: 'result', payload: {} }));
  // 'event' is a valid WS_KIND but no handler is registered for it.
  const env = buildEnvelope({ kind: 'event', id: 'a2', payload: {} });
  const sent = [];
  const out = await handleFrame({ text: JSON.stringify(env), send: (e) => sent.push(e) });
  assert.equal(out.ok, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'error');
  assert.equal(sent[0].payload.code, 'E_PROTO_NO_HANDLER');
  assert.equal(sent[0].id, 'a2');
});

test('negative: bad JSON envelope -> E_PROTO_BAD_ENVELOPE', async () => {
  __enableTestRoot();
  resetRoutes();
  const sent = [];
  const out = await handleFrame({ text: 'this is not json', send: (e) => sent.push(e) });
  assert.equal(out.ok, false);
  assert.equal(sent[0].kind, 'error');
  assert.equal(sent[0].payload.code, 'E_PROTO_BAD_ENVELOPE');
});

test('negative: handler throwing is projected to E_PROTO_NO_HANDLER or original code', async () => {
  __enableTestRoot();
  resetRoutes();
  registerHandler('command', async () => { throw new (await import('../../../contracts/error_envelope/projector.mjs')).CamoError({ code: 'E_INPUT_INVALID', details: { field: 'x' } }); });
  const env = buildEnvelope({ kind: 'command', id: 'a3', payload: {} });
  const sent = [];
  const out = await handleFrame({ text: JSON.stringify(env), send: (e) => sent.push(e) });
  assert.equal(out.ok, false);
  assert.equal(sent[0].kind, 'error');
  assert.equal(sent[0].payload.code, 'E_INPUT_INVALID');
});

test('utility: listHandlers is sorted and stable', () => {
  __enableTestRoot();
  resetRoutes();
  registerHandler('command', async () => ({ kind: 'result', payload: {} }));
  registerHandler('hello', async () => ({ kind: 'ready', payload: {} }));
  const a = listHandlers();
  assert.deepEqual(a, ['command', 'hello']);
});

test('utility: broadcastEvent dispatches to all sockets', () => {
  __enableTestRoot();
  resetRoutes();
  const sentA = [];
  const sentB = [];
  registerSocket({ send: (e) => sentA.push(e) });
  registerSocket({ send: (e) => sentB.push(e) });
  const env = broadcastEvent({ msg: 'hi' });
  assert.equal(env.kind, 'event');
  assert.equal(sentA.length, 1);
  assert.equal(sentB.length, 1);
});
