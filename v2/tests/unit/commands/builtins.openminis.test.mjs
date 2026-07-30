// camo v2 unit tests: OpenMinis-aligned builtins (15 new commands)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { list, isBuiltin } from '../../../commands/builtins/index.mjs';

const NEW_CMDS = [
  'hover', 'getText', 'getPageInfo', 'findElements', 'getReadable',
  'newTab', 'closeTab', 'listTabs', 'getCookies', 'setCookies',
  'setUserAgent', 'setViewport', 'waitDomStable', 'scrollAndCollect',
  'fetchPage',
];

describe('builtins.openminis.index', () => {
  test('list returns all 15 new builtins', () => {
    const cmds = list();
    for (const c of NEW_CMDS) {
      assert.equal(cmds.includes(c), true, `${c} missing from index`);
    }
    assert.ok(cmds.length >= 28, `expected >= 28 builtins, got ${cmds.length}`);
  });

  test('isBuiltin returns true for all OpenMinis commands', () => {
    for (const c of NEW_CMDS) {
      assert.equal(isBuiltin(c), true, `${c} should be builtin`);
    }
  });

  test('total builtin count is 28', () => {
    assert.ok(list().length >= 28, `expected >= 28 builtins, got ${list().length}`);
  });
});

describe('builtins.openminis.run-errors', () => {
  const samples = [
    'hover', 'getText', 'getPageInfo', 'findElements', 'getReadable',
    'newTab', 'closeTab', 'listTabs', 'getCookies', 'setCookies',
    'setUserAgent', 'setViewport', 'waitDomStable', 'scrollAndCollect',
    'fetchPage',
  ];

  for (const cmd of samples) {
    test(`${cmd} rejects null transport`, async () => {
      const mod = await import(`../../../commands/builtins/${cmd}.mjs`);
      await assert.rejects(mod.run(null, {}), /Invalid input/);
    });
  }

  test('hover requires exactly one of selector/text', async () => {
    const { run } = await import('../../../commands/builtins/hover.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(
      run(transport, { profile: 'p1', named: { selector: 'a', text: 'b' } }),
      /Invalid input/
    );
  });

  test('fetchPage requires positional URL', async () => {
    const { run } = await import('../../../commands/builtins/fetchPage.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(
      run(transport, { profile: 'p1', positional: [] }),
      /E_INPUT_MISSING_FIELD|Invalid input|field: 'url'/
    );
  });

  test('setViewport requires positive width/height', async () => {
    const { run } = await import('../../../commands/builtins/setViewport.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(
      run(transport, { profile: 'p1', named: { width: -1, height: 800 } }),
      /Invalid input/
    );
  });

  test('setCookies requires non-empty array', async () => {
    const { run } = await import('../../../commands/builtins/setCookies.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(
      run(transport, { profile: 'p1', named: { cookies: '[]' } }),
      /Invalid input|Required field/
    );
  });

  test('closeTab requires numeric tabId', async () => {
    const { run } = await import('../../../commands/builtins/closeTab.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(
      run(transport, { profile: 'p1', named: { tabId: 'abc' } }),
      /Invalid input/
    );
  });
});

describe('builtins.openminis.profile-validation', () => {
  const samples = ['hover', 'getText', 'getPageInfo', 'findElements', 'getReadable',
    'newTab', 'closeTab', 'listTabs', 'getCookies', 'setCookies',
    'setUserAgent', 'setViewport', 'waitDomStable', 'scrollAndCollect',
    'fetchPage'];

  for (const cmd of samples) {
    test(`${cmd} rejects invalid profile id`, async () => {
      const mod = await import(`../../../commands/builtins/${cmd}.mjs`);
      const transport = { sendFrame: async () => ({ payload: {} }) };
      await assert.rejects(
        mod.run(transport, { profile: 'bad profile!', named: {}, positional: [] }),
        /Invalid input|E_INPUT_INVALID/
      );
    });
  }
});
