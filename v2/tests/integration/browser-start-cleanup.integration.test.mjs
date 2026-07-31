import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

test('negative: failed ephemeral launch releases lock and temporary profile', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-launch-fail-home-'));
  const profile = `_ephemeral_launch_fail_${process.pid}`;
  try {
    const script = `
      import fs from 'node:fs';
      import path from 'node:path';
      import {
        __enableTestRoot,
        enableAllOwners,
        startSession,
      } from './v2/services/browser_service/bootstrap.mjs';
      __enableTestRoot();
      await enableAllOwners();
      let code = null;
      try {
        await startSession({ profileId: ${JSON.stringify(profile)}, headless: true });
      } catch (cause) {
        code = cause?.code;
      }
      const root = path.join(process.env.HOME, '.camo');
      const result = {
        code,
        lockExists: fs.existsSync(path.join(root, 'locks', ${JSON.stringify(`${profile}.lock.json`)})),
        profileExists: fs.existsSync(path.join(root, 'profiles', ${JSON.stringify(profile)})),
      };
      process.stdout.write(JSON.stringify(result));
    `;
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home,
        PLAYWRIGHT_BROWSERS_PATH: path.join(home, 'missing-playwright-browsers'),
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(out.status, 0, `subprocess failed: ${out.stderr}`);
    assert.deepEqual(JSON.parse(out.stdout), {
      code: 'E_BROWSER_LAUNCH_FAILED',
      lockExists: false,
      profileExists: false,
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
