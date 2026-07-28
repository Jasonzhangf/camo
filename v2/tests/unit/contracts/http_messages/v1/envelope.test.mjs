import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from '../../../../../contracts/http_messages/v1/envelope.mjs';
import { CamoError } from '../../../../../contracts/error_envelope/projector.mjs';

test('positive: buildRequest -> parseRequest roundtrip', () => {
  const env = http.buildRequest({ id: 'h-1', kind: 'command', method: 'POST', path: '/cmd/start', body: { args: ['p1'] } });
  assert.equal(env.v, 'camo.v2.protocol/v1');
  assert.equal(env.kind, 'command');
  assert.equal(env.method, 'POST');
  assert.equal(env.path, '/cmd/start');
  const back = http.parseRequest(JSON.stringify(env));
  assert.deepEqual(back, env);
});

test('positive: buildResponse uses allowed status range', () => {
  const r = http.buildResponse({ id: 'h-2', kind: 'result', status: 200, body: { ok: true } });
  assert.equal(r.status, 200);
  const e = http.buildResponse({ id: 'h-3', kind: 'error', status: 503 });
  assert.equal(e.status, 503);
});

test('negative: buildRequest rejects unknown method', () => {
  let err;
  try { http.buildRequest({ id: 'x', kind: 'command', method: 'BREW', path: '/' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err?.details?.field, 'method');
});

test('negative: buildRequest rejects path without leading slash', () => {
  let err;
  try { http.buildRequest({ id: 'x', kind: 'command', method: 'GET', path: 'no-slash' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err?.details?.field, 'path');
});

test('negative: buildResponse rejects out-of-range status', () => {
  let err;
  try { http.buildResponse({ id: 'x', kind: 'result', status: 42 }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err?.details?.field, 'status');
});

test('negative: buildResponse rejects result kind with error', () => {
  let err;
  try { http.buildResponse({ id: 'x', kind: 'command', status: 200 }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_ENVELOPE');
  assert.equal(err?.details?.field, 'kind');
});

test('negative: parseRequest rejects wrong version', () => {
  let err;
  try { http.parseRequest(JSON.stringify({ v: 'v0', id: 'x', kind: 'health', method: 'GET', path: '/', body: null })); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_BAD_VERSION');
});
