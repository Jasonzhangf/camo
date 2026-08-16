import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { getLaunchPath } = require('camoufox');

test('negative: failed launch releases lock and only removes metadata created by that start', () => {
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
        lockExists: fs.existsSync(path.join(root, 'profiles', ${JSON.stringify(profile)}, 'lock.json')),
        profileExists: fs.existsSync(path.join(root, 'profiles', ${JSON.stringify(profile)})),
      };
      process.stdout.write(JSON.stringify(result));
    `;
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home,
        CAMO_EXECUTABLE_PATH: getLaunchPath(),
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

    const existingScript = `
      import fs from 'node:fs';
      import path from 'node:path';
      import { write } from './v2/services/profile/store.mjs';
      import {
        __enableTestRoot,
        enableAllOwners,
        startSession,
      } from './v2/services/browser_service/bootstrap.mjs';
      const profile = ${JSON.stringify(`${profile}_existing`)};
      write(profile, { label: 'existing-profile-truth' });
      __enableTestRoot();
      await enableAllOwners();
      let code = null;
      try {
        await startSession({ profileId: profile, headless: true });
      } catch (cause) {
        code = cause?.code;
      }
      const file = path.join(process.env.HOME, '.camo', 'profiles', profile, 'camo-profile.json');
      const result = {
        code,
        profileExists: fs.existsSync(file),
        label: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).label : null,
      };
      process.stdout.write(JSON.stringify(result));
    `;
    const existingOut = spawnSync(process.execPath, ['--input-type=module', '-e', existingScript], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home,
        CAMO_EXECUTABLE_PATH: getLaunchPath(),
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(existingOut.status, 0, `subprocess failed: ${existingOut.stderr}`);
    assert.deepEqual(JSON.parse(existingOut.stdout), {
      code: 'E_BROWSER_LAUNCH_FAILED',
      profileExists: true,
      label: 'existing-profile-truth',
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
