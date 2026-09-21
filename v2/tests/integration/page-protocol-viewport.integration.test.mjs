import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

function runScript(source) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-protocol-viewport-home-'));
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

test('positive: DOM inner viewport is used when Playwright viewportSize is null', () => {
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
      async evaluate(fn) {
        if (typeof fn === 'function') return { x: 415.5, y: 357.8, width: 624, height: 48 };
        return { width: 1536, height: 849 };
      },
    };
    const page = {
      viewportSize: () => null,
      locator: () => locator,
      evaluate: async () => ({ width: 1536, height: 849 }),
      mouse: {
        move: async (...args) => calls.push(['move', ...args]),
        down: async (...args) => calls.push(['down', ...args]),
        up: async (...args) => calls.push(['up', ...args]),
        wheel: async (...args) => calls.push(['wheel', ...args]),
      },
    };
    __setBrowserForTest('protocol_dom_viewport_fallback', { page });
    const out = await click({ profileId: 'protocol_dom_viewport_fallback', target: { targetId: 't_protocol_dom_viewport_fallback', page, status: 'active' }, selector: 'input[node-type=text]' });
    process.stdout.write(JSON.stringify({ out, calls }));
  `);
  assert.equal(result.out.clicked, true);
  assert.equal(result.calls.some((entry) => entry[0] === 'wheel'), false);
  assert.deepEqual(result.calls.map((entry) => entry[0]), ['move', 'down', 'up']);
});
