import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

test('scroll operations use Camoufox page input and expose failures', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-scroll-input-home-'));
  try {
    const script = `
      import {
        __enableTestRoot,
        __setBrowserForTest,
      } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
      import {
        scroll,
        scrollAndCollect,
      } from './v2/services/page_runtime/operations/page_ops.mjs';

      __enableTestRoot();
      const profileId = '_ephemeral_scroll_input';
      const wheelCalls = [];
      let evaluateCalls = 0;
      let waitCalls = 0;
      __setBrowserForTest(profileId, {
        profileId,
        isPersistent: false,
        browser: {},
        context: {},
        page: {
          mouse: {
            wheel: async (x, y) => { wheelCalls.push([x, y]); },
          },
          viewportSize: () => ({ width: 1200, height: 1000 }),
          evaluate: async () => {
            evaluateCalls += 1;
            return [{ tag: 'p', text: 'visible text long enough for collection' }];
          },
          waitForTimeout: async () => { waitCalls += 1; },
        },
      });

      const direct = await scroll({ profileId, x: 12, y: 34 });
      const collected = await scrollAndCollect({ profileId, scrollCount: 2, scrollDelay: 1 });

      __setBrowserForTest('_ephemeral_scroll_failure', {
        profileId: '_ephemeral_scroll_failure',
        isPersistent: false,
        browser: {},
        context: {},
        page: {
          mouse: { wheel: async () => { throw new Error('wheel failed'); } },
        },
      });
      let failureCode = null;
      try {
        await scroll({ profileId: '_ephemeral_scroll_failure', x: 0, y: 10 });
      } catch (cause) {
        failureCode = cause?.code;
      }

      process.stdout.write(JSON.stringify({
        direct,
        collected,
        wheelCalls,
        evaluateCalls,
        waitCalls,
        failureCode,
      }));
    `;
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(out.status, 0, `subprocess failed: ${out.stderr}`);
    const result = JSON.parse(out.stdout);
    assert.deepEqual(result.wheelCalls, [[12, 34], [0, 800], [0, 800]]);
    assert.equal(result.direct.scrolled, true);
    assert.equal(result.collected.scrolls, 2);
    assert.equal(result.collected.collected.length, 2);
    assert.equal(result.evaluateCalls, 2);
    assert.equal(result.waitCalls, 1);
    assert.equal(result.failureCode, 'E_BROWSER_SCROLL_FAILED');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
