import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

function runScript(source) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-visible-edge-home-'));
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

test('positive: visible edge target clicks without protocol wheel input', () => {
  const result = runScript(`
    import { __enableTestRoot } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { click } from './v2/services/page_runtime/operations/interaction_ops.mjs';
    __enableTestRoot();
    enableBridge();
    const calls = [];
    const locator = {
      count: async () => 1,
      nth() { return this; },
      first() { return this; },
      async boundingBox() { return { x: 5.5, y: 744, width: 44, height: 40 }; },
    };
    const page = {
      viewportSize: () => ({ width: 390, height: 844 }),
      locator: () => locator,
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => calls.push(['wheel', ...args]),
      },
    };
    __setBrowserForTest('protocol_visible_edge', { page });
    const out = await click({ profileId: 'protocol_visible_edge', target: { targetId: 't_visible_edge', page, status: 'active' }, selector: '#teams' });
    process.stdout.write(JSON.stringify({ out, calls }));
  `);
  assert.equal(result.out.clicked, true);
  assert.equal(result.calls.filter((entry) => entry[0] === 'wheel').length, 0);
  assert.deepEqual(result.calls.map((entry) => entry[0]), ['move', 'down', 'up']);
});
