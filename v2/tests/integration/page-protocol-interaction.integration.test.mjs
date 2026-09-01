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
      waitForTimeout: async (...args) => calls.push(['wait', ...args]),
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

test('negative: hung protocol wheel times out and releases the profile pipeline', () => {
  const result = runScript(`
    import { __enableTestRoot as enablePipeline, click, getPageInfo } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    enablePipeline();
    enableBridge();
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() { return { x: 200, y: 900, width: 80, height: 20 }; },
    };
    __setBrowserForTest('protocol_hung_wheel', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      evaluate: async () => ({ title: 'still alive', url: 'https://example.com' }),
      mouse: {
        move: async () => {},
        down: async () => {},
        up: async () => {},
        wheel: async () => new Promise(() => {}),
      },
    }});

    let code = null;
    try {
      await click({ profileId: 'protocol_hung_wheel', selector: '#target', timeout: 20 });
    } catch (error) {
      code = error.code;
    }
    const info = await getPageInfo({ profileId: 'protocol_hung_wheel' });
    process.stdout.write(JSON.stringify({ code, info }));
  `);
  assert.equal(result.code, 'E_IO_TIMEOUT');
  assert.equal(result.info.title, 'still alive');
});

test('positive: offscreen click waits for wheel-driven layout settlement', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    let y = 900;
    let settled = false;
    let waitCalls = 0;
    const locator = { count: async () => 1, nth() { return this; }, first() { return this; }, async boundingBox() { return { x: 200, y, width: 80, height: 20 }; } };
    __setBrowserForTest('protocol_scroll_settlement', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      waitForTimeout: async () => { waitCalls += 1; settled = true; },
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => {
          if (!settled) throw new Error('scroll_not_settled');
          calls.push(['down', ...args]);
        },
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (x, dy) => { calls.push(['wheel', x, dy]); y = 500; },
      },
    }});
    const out = await click({ profileId: 'protocol_scroll_settlement', selector: '#target' });
    process.stdout.write(JSON.stringify({ out, calls, waitCalls }));
  `);
  assert.equal(result.out.clicked, true);
  assert.equal(result.waitCalls >= 1, true);
  assert.equal(result.calls.some((entry) => entry[0] === 'down'), true);
});

test('positive: multi-wheel click anchors once and settles before redispatch', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    let anchorMoves = 0;
    let wheelCount = 0;
    let waitCount = 0;
    let y = 1300;
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() {
        calls.push(['box', y]);
        return { x: 200, y, width: 80, height: 20 };
      },
    };
    __setBrowserForTest('protocol_multi_scroll', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      waitForTimeout: async () => {
        waitCount += 1;
        if (wheelCount === 1) y = waitCount === 1 ? 1000 : 800;
        if (wheelCount === 2) y = 500;
      },
      mouse: {
        move: async (x, moveY) => {
          calls.push(['move', x, moveY]);
          if (x === 400 && moveY === 300) {
            anchorMoves += 1;
            if (anchorMoves > 1) throw new Error('scroll_anchor_repeated');
          }
        },
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => {
          wheelCount += 1;
          waitCount = 0;
          calls.push(['wheel', ...args]);
        },
      },
    }});
    let out = null;
    let code = null;
    try { out = await click({ profileId: 'protocol_multi_scroll', selector: '#target' }); }
    catch (error) { code = error.code; }
    process.stdout.write(JSON.stringify({ out, code, calls, anchorMoves, wheelCount }));
  `);
  assert.equal(result.code, null);
  assert.equal(result.out.clicked, true);
  assert.equal(result.anchorMoves, 1);
  assert.equal(result.wheelCount, 2);
  assert.equal(result.calls.some((entry) => entry[0] === 'down'), true);
});

test('negative: second protocol wheel failure does not re-anchor the pointer', () => {
  const result = runScript(`
    import { __enableTestRoot as enablePipeline, click } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    enablePipeline();
    enableBridge();
    const calls = [];
    let wheelCount = 0;
    let anchorMoves = 0;
    let y = 1300;
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() { return { x: 200, y, width: 80, height: 20 }; },
    };
    __setBrowserForTest('protocol_second_wheel_failure', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      waitForTimeout: async () => {},
      mouse: {
        move: async (x, moveY) => {
          calls.push(['move', x, moveY]);
          if (x === 400 && moveY === 300) anchorMoves += 1;
        },
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => {
          wheelCount += 1;
          calls.push(['wheel', ...args]);
          if (wheelCount === 1) y = 800;
          else throw new Error('second wheel failed');
        },
      },
    }});
    let code = null;
    try { await click({ profileId: 'protocol_second_wheel_failure', selector: '#target' }); }
    catch (error) { code = error.code; }
    process.stdout.write(JSON.stringify({ code, calls, anchorMoves, wheelCount }));
  `);
  assert.equal(result.code, 'E_BROWSER_CLICK_FAILED');
  assert.equal(result.anchorMoves, 1);
  assert.equal(result.wheelCount, 2);
  assert.equal(result.calls.some((entry) => entry[0] === 'down' || entry[0] === 'up'), false);
});

test('positive: partially visible target clears the fixed bottom boundary with bounded wheel segments', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    let y = 1098.6;
    let wheelCount = 0;
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() { return { x: 16, y, width: 358, height: 48 }; },
    };
    __setBrowserForTest('protocol_partial_boundary', { page: {
      viewportSize: () => ({ width: 390, height: 844 }),
      locator: () => locator,
      waitForTimeout: async () => {},
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => {
          if (y + 48 > 780) throw new Error('fixed_bottom_boundary_intercepted');
          calls.push(['down', ...args]);
        },
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (x, dy) => {
          if (Math.abs(x) > 120 || Math.abs(dy) > 120) throw new Error('unbounded_wheel_delta');
          wheelCount += 1;
          y -= dy;
          calls.push(['wheel', x, dy]);
        },
      },
    }});
    let out = null;
    let code = null;
    try { out = await click({ profileId: 'protocol_partial_boundary', selector: '#target' }); }
    catch (error) { code = error.code; }
    process.stdout.write(JSON.stringify({ out, code, calls, wheelCount, y }));
  `);
  assert.equal(result.code, null);
  assert.equal(result.out.clicked, true);
  assert.equal(result.wheelCount > 1, true);
  assert.equal(result.calls.filter((entry) => entry[0] === 'wheel')
    .every((entry) => Math.abs(entry[1]) <= 120 && Math.abs(entry[2]) <= 120), true);
  assert.equal(result.calls.some((entry) => entry[0] === 'down'), true);
});

test('positive: top target clears fixed header through bounded center-directed wheel segments', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    let y = -113;
    let wheelCount = 0;
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() { return { x: 16, y, width: 58, height: 40 }; },
    };
    __setBrowserForTest('protocol_fixed_header', { page: {
      viewportSize: () => ({ width: 390, height: 844 }),
      locator: () => locator,
      waitForTimeout: async () => {},
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => {
          if (y < 64) throw new Error('fixed_header_intercepted');
          calls.push(['down', ...args]);
        },
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (x, dy) => {
          if (Math.abs(x) > 120 || Math.abs(dy) > 120) throw new Error('unbounded_wheel_delta');
          wheelCount += 1;
          y -= dy;
          calls.push(['wheel', x, dy]);
        },
      },
    }});
    let out = null;
    let code = null;
    try { out = await click({ profileId: 'protocol_fixed_header', selector: '#back' }); }
    catch (error) { code = error.code; }
    process.stdout.write(JSON.stringify({ out, code, calls, wheelCount, y }));
  `);
  assert.equal(result.code, null);
  assert.equal(result.out.clicked, true);
  assert.equal(result.wheelCount > 1, true);
  assert.equal(result.y >= 64, true);
  assert.equal(result.calls.filter((entry) => entry[0] === 'wheel')
    .every((entry) => Math.abs(entry[1]) <= 120 && Math.abs(entry[2]) <= 120), true);
  assert.equal(result.calls.some((entry) => entry[0] === 'down'), true);
});

test('negative: moving offscreen target never receives a false-success click', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    let wheelIssued = false;
    let sample = 0;
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() {
        if (!wheelIssued) return { x: 200, y: 900, width: 80, height: 20 };
        sample += 1;
        return { x: 200, y: sample % 2 ? 100 : 140, width: 80, height: 20 };
      },
    };
    __setBrowserForTest('protocol_scroll_moving', { page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => locator,
      waitForTimeout: async () => {},
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => { wheelIssued = true; calls.push(['wheel', ...args]); },
      },
    }});
    let code = null;
    try { await click({ profileId: 'protocol_scroll_moving', selector: '#target' }); }
    catch (error) { code = error.code; }
    process.stdout.write(JSON.stringify({ code, calls }));
  `);
  assert.equal(result.code, 'E_BROWSER_CLICK_FAILED');
  assert.equal(result.calls.some((entry) => entry[0] === 'down' || entry[0] === 'up'), false);
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
    const ctx = { profile: 'protocol_projection', opts: { mode: 'persistent', daemonId: 'test' }, ensureBrowser: async () => {}, operationLoader: async (name) => {
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
