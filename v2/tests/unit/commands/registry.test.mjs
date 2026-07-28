import { test } from 'node:test';
import assert from 'node:assert/strict';

import { list, has, look, describe } from '../../../commands/registry/registry.mjs';

test('positive: list returns all 6 commands sorted', () => {
  const a = list();
  assert.equal(a.length, 6);
  assert.deepEqual(a, ['click', 'goto', 'snapshot', 'start', 'stop', 'type']);
});

test('positive: has returns true for known cmd + false for unknown', () => {
  assert.equal(has('start'), true);
  assert.equal(has('not-a-cmd'), false);
  assert.equal(has(''), false);
});

test('positive: look returns frozen spec for start', () => {
  const spec = look('start');
  assert.equal(spec.cmd, 'start');
  assert.ok(spec.module.endsWith('start.mjs'));
  assert.ok(spec.args_schema.named.profile);
  assert.ok(Object.isFrozen(spec));
});

test('negative: look on unknown cmd throws E_PROTO_NO_HANDLER', () => {
  assert.throws(
    () => look('nope'),
    (e) => e.code === 'E_PROTO_NO_HANDLER'
  );
});

test('utility: describe reports count and layer', () => {
  const d = describe();
  assert.equal(d.moduleId, 'commands.registry');
  assert.equal(d.layer, 'L4_command');
  assert.equal(d.count, 6);
});
