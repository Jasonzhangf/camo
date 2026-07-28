import test from 'node:test';
import assert from 'node:assert/strict';
import * as ws from '../../../../../contracts/ws_messages/v1/envelope.mjs';
import { CamoError } from '../../../../../contracts/error_envelope/projector.mjs';

test('positive: build -> parse roundtrip preserves envelope fields', () => {
  const env = ws.build({ kind: 'command', id: 'c-1', payload: { cmd: 'start', args: ['p1'] } });
  assert.equal(env.v, 'camo.v2.protocol/v1');
  assert.equal(env.kind, 'command');
  assert.equal(env.id, 'c-1');
  assert.deepEqual(env.payload, { cmd: 'start', args: ['p1'] });
  const text = JSON.stringify(env);
  const back = ws.parse(text);
  assert.equal(back.kind, 'command');
  assert.equal(back.id, 'c-1');
  assert.deepEqual(back.payload, env.payload);
});

test('positive: build with no payload yields payload:null', () => {
  const env = ws.build({ kind: 'ping', id: 'p-1' });
  assert.equal(env.payload, null);
});

test('negative: build rejects unknown kind', () => {
  let err;
  try { ws.build({ kind: 'bogus', id: 'x' }); } catch (e) { err = e; }
  assert.equal(err instanceof CamoError, true);
  assert.equal(err.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err.details.field, 'kind');
});

test('negative: build rejects empty id', () => {
  let err;
  try { ws.build({ kind: 'command', id: '' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err?.details?.field, 'id');
});

test('negative: parse rejects wrong version', () => {
  let err;
  try { ws.parse(JSON.stringify({ v: 'camo.v2.protocol/v0', id: 'x', kind: 'command', payload: null })); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_VERSION');
});

test('negative: parse rejects non-string input', () => {
  let err;
  try { ws.parse(123); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err?.details?.field, 'text');
});

test('negative: parse rejects bad JSON', () => {
  let err;
  try { ws.parse('not json'); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
});
