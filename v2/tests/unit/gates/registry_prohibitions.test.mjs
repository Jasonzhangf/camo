import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractImportSpecifiers,
  prohibitedImportModules,
  prohibitedImportSymbols,
} from '../../../gates/registry_gates/gates/_helpers.mjs';

const target = 'v2/services/daemon_registration/registry.mjs';
const source = 'v2/commands/builtins/probe.mjs';
const symbols = ['claimDaemonSlot', 'registerDaemon', 'releaseDaemonSlot', 'unregisterDaemon'];

function detected(text) {
  return prohibitedImportSymbols({
    text,
    sourcePath: source,
    targetPath: target,
    symbols,
  });
}

test('negative: named daemon-registration write imports are detected', () => {
  assert.deepEqual(
    detected("import { unregisterDaemon as remove } from '../../services/daemon_registration/registry.mjs';"),
    ['unregisterDaemon'],
  );
});

test('negative: namespace daemon-registration imports cannot bypass write ownership', () => {
  assert.deepEqual(
    detected("import * as registry from '../../services/daemon_registration/registry.mjs'; registry.unregisterDaemon();"),
    ['*'],
  );
});

test('negative: daemon-registration write re-exports are detected', () => {
  assert.deepEqual(
    detected("export { registerDaemon } from '../../services/daemon_registration/registry.mjs';"),
    ['registerDaemon'],
  );
  assert.deepEqual(
    detected("export * from '../../services/daemon_registration/registry.mjs';"),
    ['*'],
  );
});

test('negative: dynamic daemon-registration imports cannot bypass write ownership', () => {
  assert.deepEqual(
    detected("const registry = await import('../../services/daemon_registration/registry.mjs'); registry.releaseDaemonSlot();"),
    ['*'],
  );
  assert.deepEqual(
    detected('const registry = await import(`../../services/daemon_registration/registry.mjs`); registry.releaseDaemonSlot();'),
    ['*'],
  );
  assert.deepEqual(
    detected("const target = '../../services/daemon_registration/registry.mjs'; await import(target);"),
    ['*'],
  );
});

test('negative: ESM query and fragment specifiers cannot bypass write ownership', () => {
  assert.deepEqual(
    detected("import { unregisterDaemon } from '../../services/daemon_registration/registry.mjs?writer';"),
    ['unregisterDaemon'],
  );
  assert.deepEqual(
    detected("export { registerDaemon } from '../../services/daemon_registration/registry.mjs#writer';"),
    ['registerDaemon'],
  );
});

test('positive: read-only named imports remain allowed', () => {
  assert.deepEqual(
    detected("import { findActiveDaemon } from '../../services/daemon_registration/registry.mjs';"),
    [],
  );
});

test('negative: shared AST extractor exposes every static ESM import form', () => {
  assert.deepEqual(
    extractImportSpecifiers(`
      import value from './declaration.mjs?reader';
      export { value as next } from './named.mjs#projection';
      export * from './all.mjs';
      const quoted = import('./quoted.mjs');
      const template = import(\`./template.mjs?runtime\`);
    `).map(({ specifier }) => specifier),
    [
      './declaration.mjs?reader',
      './named.mjs#projection',
      './all.mjs',
      './quoted.mjs',
      './template.mjs?runtime',
    ],
  );
});

test('negative: import_module rejects template, suffix, subpath, and unknown dynamic imports', () => {
  assert.deepEqual(
    prohibitedImportModules({
      text: `
        const direct = await import(\`playwright\`);
        const query = await import('playwright?runtime');
        const subpath = await import('playwright/test');
        const target = 'playwright';
        const unknown = await import(target);
      `,
      moduleName: 'playwright',
    }),
    ['<dynamic>', 'playwright', 'playwright/test', 'playwright?runtime'],
  );
});

test('positive: import_module ignores statically different modules', () => {
  assert.deepEqual(
    prohibitedImportModules({
      text: "import value from 'not-playwright';",
      moduleName: 'playwright',
    }),
    [],
  );
});
