import { test } from 'node:test';
import assert from 'node:assert/strict';

import { list, isBuiltin, describe as describeB, run as runDispatcher } from '../../../commands/builtins/index.mjs';
import { look as registryLook, list as registryList } from '../../../commands/registry/registry.mjs';

// Use kebab-case to match registry convention
const EXPECTED_BUILTINS = [
  'click', 'close-tab', 'daemon', 'evaluate', 'fetch-page', 'find-elements',
  'get-cookies', 'get-page-info', 'get-readable', 'get-text', 'goto', 'hover',
  'list-tabs', 'login', 'multi-open', 'new-tab', 'screenshot', 'scroll', 'scroll-and-collect', 'search', 'select',
  'set-cookies', 'set-user-agent', 'set-viewport', 'snapshot', 'start', 'stop',
  'switch-tab', 'type', 'upload', 'wait', 'wait-dom-stable',
];

test('positive: list returns all 32 builtins sorted (kebab-case)', () => {
  assert.deepEqual(list(), EXPECTED_BUILTINS);
});

test('positive: isBuiltin only matches known ids', () => {
  assert.equal(isBuiltin('start'), true);
  assert.equal(isBuiltin('snapshot'), true);
  assert.equal(isBuiltin('scroll'), true);
  assert.equal(isBuiltin('search'), true);
  assert.equal(isBuiltin('nonexistent'), false);
  assert.equal(isBuiltin(''), false);
  // Also test kebab-case input
  assert.equal(isBuiltin('scroll-and-collect'), true);
});

test('positive: describe reports moduleId+layer+count', () => {
  const d = describeB();
  assert.equal(d.moduleId, 'commands.builtins');
  assert.equal(d.layer, 'L4_command');
  assert.equal(d.count, EXPECTED_BUILTINS.length);
});

test('positive: every builtin has a corresponding registry entry', () => {
  const builtins = list();
  const registry = registryList();
  const missing = builtins.filter(b => !registry.includes(b));
  assert.deepEqual(missing, [], `Missing registry entries for: ${missing.join(', ')}`);
});

test('negative: dispatcher.run throws E_PROTO_NO_HANDLER for unknown cmd', async () => {
  await assert.rejects(
    () => runDispatcher('nonexistent', null, {}, {}),
    (err) => {
      assert.ok(err.code === 'E_PROTO_NO_HANDLER' || err.message?.includes('E_PROTO_NO_HANDLER'));
      return true;
    }
  );
});
