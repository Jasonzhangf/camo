import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __enableTestRoot,
  plan,
  attach,
  attachProgress,
  describe,
  fanOutEvent,
  __resetForTest,
} from '../../../transports/daemon/dispatch.mjs';

test('positive: plan + attach + fanOutEvent returns v1 ws envelope', () => {
  __enableTestRoot();
  __resetForTest();
  __enableTestRoot();
  plan({ profileId: 'p1', wsPort: 9001, httpPort: 9002 });
  attach('ws', 9001);
  attach('http', 9002);
  attachProgress();
  const env = fanOutEvent({ type: 'progress', msg: 'hi' });
  assert.equal(env.kind, 'event');
  assert.equal(env.payload.type, 'progress');
  assert.equal(env.payload.msg, 'hi');
  const desc = describe();
  assert.equal(desc.profileId, 'p1');
  assert.equal(desc.ws.attached, true);
  assert.equal(desc.http.attached, true);
  assert.equal(desc.progress.wired, true);
});

test('negative: plan without profileId throws E_INPUT_MISSING_FIELD', () => {
  __enableTestRoot();
  __resetForTest();
  __enableTestRoot();
  assert.throws(
    () => plan({}),
    (e) => e.code === 'E_INPUT_MISSING_FIELD'
  );
});

test('negative: attach before plan throws E_STATE_NOT_FOUND', () => {
  __enableTestRoot();
  __resetForTest();
  __enableTestRoot();
  assert.throws(
    () => attach('ws', 9001),
    (e) => e.code === 'E_STATE_NOT_FOUND'
  );
});

test('negative: attach with bad port throws E_INPUT_OUT_OF_RANGE', () => {
  __enableTestRoot();
  __resetForTest();
  __enableTestRoot();
  plan({ profileId: 'p1' });
  assert.throws(
    () => attach('ws', 99999),
    (e) => e.code === 'E_INPUT_OUT_OF_RANGE'
  );
});
