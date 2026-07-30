import { test } from 'node:test';
import assert from 'node:assert/strict';

import { list, isBuiltin, describe as describeB, run as runDispatcher } from '../../../commands/builtins/index.mjs';
import { look as registryLook, list as registryList } from '../../../commands/registry/registry.mjs';

const EXPECTED_BUILTINS = [
  'click', 'closeTab', 'daemon', 'evaluate', 'fetchPage', 'findElements',
  'getCookies', 'getPageInfo', 'getReadable', 'getText', 'goto', 'hover',
  'listTabs', 'newTab', 'screenshot', 'scroll', 'scrollAndCollect', 'select',
  'setCookies', 'setUserAgent', 'setViewport', 'snapshot', 'start', 'stop',
  'type', 'upload', 'wait', 'waitDomStable',
];

// Helper: camelCase -> kebab-case
const toKebab = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

test('positive: list returns the 28 builtins sorted', () => {
  assert.deepEqual(list(), EXPECTED_BUILTINS);
});

test('positive: isBuiltin only matches known ids', () => {
  assert.equal(isBuiltin('start'), true);
  assert.equal(isBuiltin('snapshot'), true);
  assert.equal(isBuiltin('scroll'), true);
  assert.equal(isBuiltin('nonexistent'), false);
  assert.equal(isBuiltin(''), false);
});

test('positive: describe reports moduleId+layer+count', () => {
  const d = describeB();
  assert.equal(d.moduleId, 'commands.builtins');
  assert.equal(d.layer, 'L4_command');
  assert.equal(d.count, 28);
});

test('positive: every builtin has a corresponding registry entry', () => {
  // builtins.list() returns camelCase; registry uses kebab-case.
  const registryCmds = new Set(registryList());
  for (const c of list()) {
    const kebab = toKebab(c);
    assert.equal(registryCmds.has(kebab), true, `${c} should have registry entry via ${kebab}`);
  }
});

test('negative: dispatcher.run throws E_PROTO_NO_HANDLER for unknown cmd', async () => {
  await assert.rejects(
    () => runDispatcher('nonexistent', {}, {}, {}),
    (e) => e.code === 'E_PROTO_NO_HANDLER'
  );
});
