// temp alias lifecycle through daemon command handlers.
//
// First start allocates a fresh _temp_<pid>_<ts> id and remembers the mapping.
// Second start returns the same allocated id and does NOT spin up a fresh browser.
// stop resolves the alias to the actual id, closes the browser, and clears the map.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import * as bootstrap from '../../../services/browser_service/bootstrap.mjs';
import { handleCommand } from '../../../shell/daemon/command_handlers.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import * as session from '../../../services/session/manager.mjs';
import {
  __enableTestRoot as enableBridgeTestRoot,
  __setBrowserForTest,
  __resetForTest as resetBridge,
} from '../../../services/browser_service/internal/camoufox_bridge.mjs';
import {
  __enableTestRoot as enableProfileRoot,
  __setProfilesRootForTest,
} from '../../../services/profile/store.mjs';
import {
  __enableTestRoot as enableLockRoot,
  __setLocksRootForTest,
} from '../../../services/lock/manager.mjs';
import {
  __enableTestRoot as enableTabPool,
  __resetForTest as resetTabPool,
} from '../../../services/page_runtime/tab_pool.mjs';
import * as progressLog from '../../../services/progress_event/log.mjs';

bootstrap.__enableTestRoot();
enableBridgeTestRoot();
session.__enableTestRoot();
enableProfileRoot();
enableLockRoot();
enableTabPool();
progressLog.__enableTestRoot();

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-temp-alias-'));
const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-temp-alias-runs-'));
__setProfilesRootForTest(profileRoot);
__setLocksRootForTest(profileRoot);
progressLog.__setRunsRootForTest(runsRoot);
process.env.CAMO_PATHS_PROFILES = profileRoot;

let launchCount = 0;
const launch = async (profileId) => {
  launchCount++;
  const record = stubBrowser(profileId);
  __setBrowserForTest(profileId, record);
  return { createdAt: new Date().toISOString(), ...record };
};
const close = async (profileId) => {
  resetBridge();
  return profileId.length > 0;
};
bootstrap.__setBrowserLifecycleForTest({ launch, close });

function fakeCtx({ allocations }) {
  return {
    profile: 'temp',
    opts: { mode: 'persistent', daemonId: 'temp-alias-test' },
    ensureBrowser: async () => {},
    ephemeralAllocations: allocations,
  };
}

function stubBrowser(profileId) {
  return {
    profileId,
    page: { goto: async () => {} },
    browser: () => ({ close: async () => {} }),
    context: { pages: () => [{ url: () => 'about:blank' }] },
  };
}

test.afterEach(() => {
  resetBridge();
  session.__resetForTest();
  resetTabPool();
  launchCount = 0;
});

test.after(() => {
  bootstrap.__setBrowserLifecycleForTest({});
  delete process.env.CAMO_PATHS_PROFILES;
  fs.rmSync(profileRoot, { recursive: true, force: true });
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

test('positive: first start on temp allocates a fresh _temp id and reuses it on the second start', async () => {
  const allocations = new Map();
  const ctx = fakeCtx({ allocations });

  const first = await handleCommand('start', {}, ctx);
  assert.match(first.profile, /^_temp_\d+_\d+$/);
  assert.equal(first.reused, undefined);
  assert.equal(allocations.get('temp'), first.profile);
  assert.equal(launchCount, 1);

  const second = await handleCommand('start', {}, ctx);
  assert.equal(second.profile, first.profile, 'second start must reuse the same allocated id');
  assert.equal(second.ephemeral, true);
  assert.equal(second.reused, true);
  assert.equal(launchCount, 1, 'reuse must not launch another browser');
});

test('positive: stop on temp closes the allocated browser and clears the alias map', async () => {
  const allocations = new Map();
  const ctx = fakeCtx({ allocations });
  const start = await handleCommand('start', {}, ctx);

  const stopped = await handleCommand('stop', {}, ctx);
  assert.equal(stopped.profile, start.profile);
  assert.equal(allocations.has('temp'), false, 'alias must be cleared on stop');
});

test('negative: stop on temp without a prior allocation surfaces a typed error and never silently succeeds', async () => {
  const allocations = new Map();
  const ctx = fakeCtx({ allocations });
  let err;
  try { await handleCommand('stop', {}, ctx); } catch (e) { err = e; }
  assert.ok(err, 'stop on unallocated temp alias must throw');
  assert.ok(err instanceof CamoError);
  assert.equal(err.code, 'E_STATE_NOT_FOUND', 'must be a typed not-found error');
});

test('negative: stale temp allocation fails closed instead of allocating another browser', async () => {
  const allocations = new Map([['temp', '_temp_999_123']]);
  const ctx = fakeCtx({ allocations });
  let err;
  try { await handleCommand('start', {}, ctx); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_STATE_INVALID');
  assert.equal(err?.details?.resource, 'ephemeral_allocations');
  assert.equal(launchCount, 0, 'stale allocation must not create another browser');
  assert.equal(allocations.get('temp'), '_temp_999_123', 'stale truth remains visible for explicit repair');
});

test('negative: reusing a named persistent profile never creates a temp alias', async () => {
  const allocations = new Map();
  const ctx = { ...fakeCtx({ allocations }), profile: 'named-profile' };

  const first = await handleCommand('start', {}, ctx);
  assert.equal(first.profile, 'named-profile');
  const second = await handleCommand('start', {}, ctx);
  assert.equal(second.reused, true);
  assert.equal(allocations.has('temp'), false, 'persistent reuse must not poison the temp alias');

  await handleCommand('stop', {}, ctx);
});

test('positive: named ephemeral alias resolves to its allocated profile for reuse and stop', async () => {
  const allocations = new Map();
  const ctx = { ...fakeCtx({ allocations }), profile: 'named-ephemeral' };

  const first = await handleCommand('start', { ephemeral: true }, ctx);
  assert.match(first.profile, /^_temp_\d+_\d+$/);
  assert.equal(allocations.get('named-ephemeral'), first.profile);

  const second = await handleCommand('start', { ephemeral: true }, ctx);
  assert.equal(second.profile, first.profile);
  assert.equal(second.reused, true);

  const stopped = await handleCommand('stop', {}, ctx);
  assert.equal(stopped.profile, first.profile);
  assert.equal(allocations.has('named-ephemeral'), false);
});
