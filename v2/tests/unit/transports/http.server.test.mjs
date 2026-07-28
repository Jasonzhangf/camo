import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __enableTestRoot,
  registerRoute,
  handleRequest,
  listRoutes,
  resetRoutes,
} from '../../../transports/http/server.mjs';
import { buildRequest } from '../../../contracts/http_messages/v1/envelope.mjs';

test('positive: registerRoute + handleRequest returns result envelope', async () => {
  __enableTestRoot();
  resetRoutes();
  registerRoute('GET', '/health', async () => ({ kind: 'result', status: 200, body: { ok: true } }));
  const req = buildRequest({ id: 'h1', kind: 'health', method: 'GET', path: '/health', body: null });
  const reply = await handleRequest({ text: JSON.stringify(req) });
  assert.equal(reply.kind, 'result');
  assert.equal(reply.status, 200);
  assert.equal(reply.body.ok, true);
});

test('negative: unknown path returns E_PROTO_NO_HANDLER 404 envelope', async () => {
  __enableTestRoot();
  resetRoutes();
  const req = buildRequest({ id: 'h2', kind: 'command', method: 'GET', path: '/nope', body: null });
  const reply = await handleRequest({ text: JSON.stringify(req) });
  assert.equal(reply.kind, 'error');
  assert.equal(reply.status, 404);
  assert.equal(reply.body.code, 'E_PROTO_NO_HANDLER');
});

test('negative: invalid JSON envelope returns E_PROTO_BAD_ENVELOPE 400', async () => {
  __enableTestRoot();
  resetRoutes();
  const reply = await handleRequest({ text: 'not json' });
  assert.equal(reply.kind, 'error');
  assert.equal(reply.status, 400);
  assert.equal(reply.body.code, 'E_PROTO_BAD_ENVELOPE');
});

test('utility: listRoutes sorted and deduped by (method,path)', () => {
  __enableTestRoot();
  resetRoutes();
  registerRoute('GET', '/a', async () => ({ kind: 'result' }));
  registerRoute('POST', '/b', async () => ({ kind: 'result' }));
  const a = listRoutes();
  // sort is by (path+method); '/a' < '/b'
  assert.deepEqual(a, [{ method: 'GET', path: '/a' }, { method: 'POST', path: '/b' }]);
});
