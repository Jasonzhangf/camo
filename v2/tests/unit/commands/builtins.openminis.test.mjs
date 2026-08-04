// camo v2 unit tests: OpenMinis-aligned builtins (15 new commands)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { list, isBuiltin } from '../../../commands/builtins/index.mjs';

// Use kebab-case to match list() output
const NEW_CMDS = [
  'hover', 'get-text', 'get-page-info', 'find-elements', 'get-readable',
  'new-tab', 'close-tab', 'list-tabs', 'get-cookies', 'set-cookies',
  'set-user-agent', 'set-viewport', 'wait-dom-stable', 'scroll-and-collect',
  'fetch-page',
];

describe('builtins.openminis.index', () => {
  test('list returns all 15 new builtins', () => {
    const cmds = list();
    for (const c of NEW_CMDS) {
      assert.equal(cmds.includes(c), true, `${c} missing from index`);
    }
    assert.ok(cmds.length >= 29, `expected >= 29 builtins, got ${cmds.length}`);
  });

  test('isBuiltin returns true for all OpenMinis commands', () => {
    for (const c of NEW_CMDS) {
      assert.equal(isBuiltin(c), true, `${c} should be builtin`);
    }
  });

  test('total builtin count is >= 29', () => {
    assert.ok(list().length >= 29, `expected >= 29 builtins, got ${list().length}`);
  });
});

describe('builtins.openminis.run-errors', () => {
  const samples = [
    'hover', 'get-text', 'get-page-info', 'find-elements', 'get-readable',
    'new-tab', 'close-tab', 'list-tabs', 'get-cookies', 'set-cookies',
    'set-user-agent', 'set-viewport', 'wait-dom-stable', 'scroll-and-collect',
    'fetch-page',
  ];
  
  // Helper: camelCase module name from kebab
  const toCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  
  for (const cmd of samples) {
    test(`${cmd} rejects null transport`, async () => {
      const mod = await import(`../../../commands/builtins/${toCamel(cmd)}.mjs`);
      await assert.rejects(mod.run(null, {}), /Invalid input/);
    });
  }
});

describe('builtins.openminis.profile-validation', () => {
  const toCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  
  const profileTests = [
    'hover', 'get-text', 'get-page-info', 'find-elements', 'get-readable',
    'new-tab', 'close-tab', 'list-tabs', 'get-cookies', 'set-cookies',
    'set-user-agent', 'set-viewport', 'wait-dom-stable', 'scroll-and-collect',
    'fetch-page',
  ];
  
  for (const cmd of profileTests) {
    test(`${cmd} rejects invalid profile id`, async () => {
      const mod = await import(`../../../commands/builtins/${toCamel(cmd)}.mjs`);
      const transport = { sendFrame: async () => ({ payload: {} }) };
      await assert.rejects(
        mod.run(transport, { profile: 'invalid profile!' }),
        /Invalid/
      );
    });
  }
});
