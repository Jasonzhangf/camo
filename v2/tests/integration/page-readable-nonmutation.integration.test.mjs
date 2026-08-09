import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

test('getReadable extracts from a clone without mutating the live document', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-readable-home-'));
  try {
    const script = `
      import { __enableTestRoot as enablePipeline } from './v2/services/page_runtime/input_pipeline.mjs';
      import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
      import { getReadable } from './v2/services/page_runtime/operations/query_ops.mjs';
      enablePipeline();
      enableBridge();
      const state = { liveQueries: 0, liveRemovals: 0, cloneRemovals: 0 };
      const clone = {
        textContent: '  readable body with navigation removed  ',
        querySelectorAll() {
          return [{ remove() { state.cloneRemovals += 1; } }];
        },
      };
      const main = { cloneNode() { return clone; } };
      globalThis.document = {
        body: main,
        querySelector(selector) { return selector === 'main' ? main : null; },
        querySelectorAll() {
          state.liveQueries += 1;
          return [{ remove() { state.liveRemovals += 1; } }];
        },
      };
      __setBrowserForTest('readable_nonmutation', {
        page: { evaluate: async (fn, arg) => fn(arg) },
      });
      const output = await getReadable({ profileId: 'readable_nonmutation', maxLength: 13 });
      process.stdout.write(JSON.stringify({ output, state }));
    `;
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(out.status, 0, out.stderr);
    const result = JSON.parse(out.stdout);
    assert.equal(result.output.text, 'readable body\n... [truncated]');
    assert.equal(result.state.liveQueries, 0);
    assert.equal(result.state.liveRemovals, 0);
    assert.equal(result.state.cloneRemovals, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
