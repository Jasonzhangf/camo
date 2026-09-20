import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('../../../', import.meta.url);

function runScript(source) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-dialog-home-'));
  try {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: ROOT.pathname,
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

test('positive: click accepts a native prompt through protocol dialog handling', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot(); enableBridge();
    const calls = []; const listeners = new Map();
    const locator = { count: async () => 1, nth() { return this; }, async boundingBox() { return { x: 20, y: 30, width: 80, height: 20 }; } };
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }), locator: () => locator,
      on(name, handler) { listeners.set(name, handler); },
      off(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
      mouse: {
        move: async () => {}, down: async () => {},
        up: async () => { const handler = listeners.get('dialog'); if (handler) await handler({
          type: () => 'prompt', message: () => '请描述售后原因', defaultValue: () => '',
          accept: async (value) => calls.push(['accept', value]), dismiss: async () => calls.push(['dismiss']),
        }); },
      },
    };
    __setBrowserForTest('protocol_dialog', { page });
    const out = await click({ profileId: 'protocol_dialog', target: { targetId: 't_dialog', page, status: 'active' }, selector: '#after-sale', dialogAction: 'accept', dialogText: '尺寸不合适' });
    process.stdout.write(JSON.stringify({ out, listenerRemoved: !listeners.has('dialog'), calls }));
  `);
  assert.equal(result.out.clicked, true);
  assert.deepEqual(result.out.dialog, { type: 'prompt', message: '请描述售后原因', defaultValue: '', action: 'accept' });
  assert.equal(result.listenerRemoved, true);
  assert.deepEqual(result.calls, [['accept', '尺寸不合适']]);
});

test('negative: click rejects an unknown dialog action before input', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot(); enableBridge(); const calls = [];
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
      locator: () => ({ count: async () => 1, nth() { return this; }, async boundingBox() { return { x: 20, y: 30, width: 80, height: 20 }; } }),
      mouse: { move: async () => calls.push('move'), down: async () => calls.push('down'), up: async () => calls.push('up') },
    };
    __setBrowserForTest('protocol_dialog_invalid', { page });
    let code = null; try { await click({ profileId: 'protocol_dialog_invalid', target: { targetId: 't_dialog_invalid', page, status: 'active' }, selector: '#after-sale', dialogAction: 'invalid' }); }
    catch (error) { code = error.code; } process.stdout.write(JSON.stringify({ code, calls }));
  `);
  assert.equal(result.code, 'E_INPUT_INVALID');
  assert.deepEqual(result.calls, []);
});
