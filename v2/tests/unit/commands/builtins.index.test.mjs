import { test } from 'node:test';
import assert from 'node:assert/strict';

import { list, isBuiltin, describe as describeB, run as runDispatcher } from '../../../commands/builtins/index.mjs';
import { look as registryLook } from '../../../commands/registry/registry.mjs';

test('positive: list returns the 5 builtins sorted', () => {
  assert.deepEqual(list(), ['click', 'goto', 'start', 'stop', 'type']);
});

test('positive: isBuiltin only matches known ids', () => {
  assert.equal(isBuiltin('start'), true);
  assert.equal(isBuiltin('snapshot'), false);
  assert.equal(isBuiltin(''), false);
});

test('positive: describe reports moduleId+layer+count', () => {
  const d = describeB();
  assert.equal(d.moduleId, 'commands.builtins');
  assert.equal(d.layer, 'L4_command');
  assert.equal(d.count, 5);
});

test('positive: every list() entry has a corresponding registry entry', () => {
  // Bridges between dispatcher and registry.json so the registry remains
  // the source of truth (registry.json must list every builtin).
  for (const c of list()) {
    const spec = registryLook(c);
    assert.equal(spec.cmd, c);
    assert.ok(spec.module.endsWith(`${c}.mjs`), `${c}.mjs should be the module path`);
  }
});

test('negative: dispatcher.run throws E_PROTO_NO_HANDLER for unknown cmd', async () => {
  await assert.rejects(
    () => runDispatcher('nonexistent', {}, {}, {}),
    (e) => e.code === 'E_PROTO_NO_HANDLER'
  );
});
