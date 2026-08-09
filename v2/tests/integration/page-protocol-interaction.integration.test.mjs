import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

function runScript(source) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-protocol-input-home-'));
  try {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: ROOT,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(out.status, 0, `subprocess failed: ${out.stderr}`);
    return JSON.parse(out.stdout);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('positive: click, hover, and type use only protocol mouse/keyboard events', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click, hover, type as typeText } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() { return { x: 20, y: 30, width: 80, height: 20 }; },
    };
    __setBrowserForTest('protocol_positive', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      getByText: () => locator,
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => calls.push(['wheel', ...args]),
      },
      keyboard: {
        press: async (...args) => calls.push(['press', ...args]),
        type: async (...args) => calls.push(['type', ...args]),
      },
    }});
    const clickOut = await click({ profileId: 'protocol_positive', selector: '#submit' });
    const hoverOut = await hover({ profileId: 'protocol_positive', selector: '#submit' });
    const typeOut = await typeText({ profileId: 'protocol_positive', selector: '#name', text: 'Jason' });
    process.stdout.write(JSON.stringify({ clickOut, hoverOut, typeOut, calls }));
  `);
  assert.equal(result.clickOut.clicked, true);
  assert.equal(result.hoverOut.hovered, true);
  assert.equal(result.typeOut.typed, true);
  assert.deepEqual(result.calls.map((entry) => entry[0]), [
    'move', 'down', 'up', 'move', 'move', 'down', 'up', 'press', 'press', 'type',
  ]);
  assert.equal(result.calls.some((entry) => entry[0] === 'evaluate'), false);
});

test('positive: offscreen target enters viewport through protocol wheel input', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    let y = 900;
    const locator = { count: async () => 1, nth() { return this; }, first() { return this; }, async boundingBox() { return { x: 200, y, width: 80, height: 20 }; } };
    __setBrowserForTest('protocol_scroll', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (x, dy) => { calls.push(['wheel', x, dy]); y -= 500; },
      },
    }});
    const out = await click({ profileId: 'protocol_scroll', selector: '#target' });
    process.stdout.write(JSON.stringify({ out, calls }));
  `);
  assert.equal(result.out.clicked, true);
  assert.equal(result.calls.filter((entry) => entry[0] === 'wheel').length, 1);
});

test('positive: visible duplicate wins over offscreen duplicate', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    const boxes = [
      { x: 300, y: 900, width: 10, height: 10 },
      { x: 300, y: 120, width: 80, height: 20 },
    ];
    let selected = -1;
    const locator = {
      count: async () => boxes.length,
      nth(index) { selected = index; return { boundingBox: async () => boxes[index] }; },
    };
    __setBrowserForTest('protocol_visible_duplicate', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => calls.push(['wheel', ...args]),
      },
    }});
    const out = await click({ profileId: 'protocol_visible_duplicate', selector: '#target' });
    process.stdout.write(JSON.stringify({ out, selected, calls }));
  `);
  assert.equal(result.out.clicked, true);
  assert.equal(result.selected, 1);
  assert.equal(result.calls.some((entry) => entry[0] === 'wheel'), false);
});

test('negative: protocol interaction failures remain explicit', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click, type as typeText } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const missing = { count: async () => 1, nth() { return this; }, first() { return this; }, async boundingBox() { return null; } };
    __setBrowserForTest('protocol_failure', { page: {
      viewportSize: () => ({ width: 800, height: 600 }), locator: () => missing,
      mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
      keyboard: { press: async () => {}, type: async () => {} },
    }});
    const codes = [];
    for (const action of [
      () => click({ profileId: 'protocol_failure', selector: '#missing' }),
      () => typeText({ profileId: 'protocol_failure', selector: '#missing', text: 'x' }),
      () => typeText({ profileId: 'protocol_failure', selector: '#missing', text: '' }),
    ]) {
      try { await action(); } catch (error) { codes.push(error.code); }
    }
    process.stdout.write(JSON.stringify({ codes }));
  `);
  assert.deepEqual(result.codes, ['E_BROWSER_CLICK_FAILED', 'E_BROWSER_TYPE_FAILED', 'E_INPUT_MISSING_FIELD']);
});

test('positive: wait/readable command projections preserve operation fields', () => {
  const result = runScript(`
    import { __enableTestRoot as enablePipeline } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { handleCommand } from './v2/shell/daemon/command_handlers.mjs';
    enablePipeline();
    enableBridge();
    const calls = [];
    const original = globalThis.__camoTestImportOp;
    globalThis.__camoTestImportOp = null;
    const page = {
      waitForLoadState: async () => {},
      getByText: () => ({ waitFor: async () => {} }),
      locator: () => ({ waitFor: async () => {} }),
      evaluate: async () => 'readable body',
    };
    __setBrowserForTest('protocol_projection', { page });
    const ctx = { profile: 'protocol_projection', isEphemeral: false, opts: { mode: 'persistent', daemonId: 'test' }, browserState: {}, ensureBrowser: async () => {}, releaseBrowser: async () => {}, operationLoader: async (name) => {
      const ops = await import('./v2/services/page_runtime/input_pipeline.mjs');
      return ops[name];
    } };
    const waitResult = await handleCommand('wait', { for: 'text', target: 'Ready', timeout: 20 }, ctx);
    const readableResult = await handleCommand('get-readable', {}, ctx);
    calls.push(waitResult, readableResult);
    globalThis.__camoTestImportOp = original;
    process.stdout.write(JSON.stringify({ calls }));
  `);
  assert.equal(result.calls[0].ok, true);
  assert.equal(result.calls[0].waited, true);
  assert.equal(result.calls[1].ok, true);
  assert.equal(typeof result.calls[1].text, 'string');
});
