import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as bootstrap from '../../../services/browser_service/bootstrap.mjs';
import * as bridge from '../../../services/browser_service/internal/camoufox_bridge.mjs';
import * as session from '../../../services/session/manager.mjs';
import * as profileStore from '../../../services/profile/store.mjs';
import * as lockManager from '../../../services/lock/manager.mjs';
import * as tabPool from '../../../services/page_runtime/tab_pool.mjs';
import { handleCommand } from '../../../shell/daemon/command_handlers.mjs';

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-multi-profile-idle-'));

bootstrap.__enableTestRoot();
await bootstrap.enableAllOwners();
bridge.__enableTestRoot();
session.__enableTestRoot();
profileStore.__enableTestRoot();
lockManager.__enableTestRoot();
tabPool.__enableTestRoot();

profileStore.__setProfilesRootForTest(profileRoot);
lockManager.__setLocksRootForTest(profileRoot);
process.env.CAMO_PATHS_PROFILES = profileRoot;

function stubPage() {
  return {
    url: () => 'about:blank',
    goto: async () => ({ status: () => 200, ok: () => true }),
  };
}

function stubRecord(profileId) {
  return {
    profileId,
    page: stubPage(),
    browser: () => ({ close: async () => {} }),
    context: {
      pages: () => [stubPage()],
      close: async () => {},
    },
    fingerprint: {},
    createdAt: new Date().toISOString(),
  };
}

const launch = async (profileId) => {
  const record = stubRecord(profileId);
  bridge.__setBrowserForTest(profileId, record);
  return record;
};
const close = async (profileId) => bridge.closeBrowser(profileId);

bootstrap.__setBrowserLifecycleForTest({ launch, close });

function makeCtx(profile) {
  return {
    profile,
    isEphemeral: false,
    opts: { mode: 'persistent', daemonId: `test-${profile}` },
    ensureBrowser: async () => {},
    releaseBrowser: async () => {},
    browserState: { currentBrowserProfile: null, browserRefCount: 0 },
    ephemeralAllocations: new Map(),
  };
}

test.afterEach(() => {
  bridge.__resetForTest();
  session.__resetForTest();
  tabPool.__resetForTest();
});

test.after(() => {
  bootstrap.__setBrowserLifecycleForTest({});
  delete process.env.CAMO_PATHS_PROFILES;
  fs.rmSync(profileRoot, { recursive: true, force: true });
});

test('positive: starting profile B does not close profile A', async () => {
  const a = await handleCommand('start', { url: 'https://example.com/a' }, makeCtx('agent-a'));
  const b = await handleCommand('start', { url: 'https://example.com/b' }, makeCtx('agent-b'));

  assert.equal(a.profile, 'agent-a');
  assert.equal(b.profile, 'agent-b');
  assert.deepEqual(bootstrap.listSessions().sort(), ['agent-a', 'agent-b']);

  await handleCommand('stop', {}, makeCtx('agent-a'));
  assert.deepEqual(bootstrap.listSessions(), ['agent-b']);
});

test('positive: idle sweep stops an expired profile', async () => {
  await handleCommand('start', {}, makeCtx('idle-expired'));
  const result = await bootstrap.sweepIdleSessions(0);
  assert.deepEqual(result.stopped, ['idle-expired']);
  assert.deepEqual(bootstrap.listSessions(), []);
});

test('negative: idle sweep preserves an active profile', async () => {
  await handleCommand('start', {}, makeCtx('idle-active'));
  const result = await bootstrap.sweepIdleSessions(60000);
  assert.deepEqual(result.stopped, []);
  assert.deepEqual(bootstrap.listSessions(), ['idle-active']);
});

test('positive: idle sweep skips profiles with in-flight commands', async () => {
  await handleCommand('start', {}, makeCtx('inflight-a'));
  await handleCommand('start', {}, makeCtx('inflight-b'));
  const result = await bootstrap.sweepIdleSessions(0, { skipProfiles: ['inflight-b'] });
  assert.deepEqual(result.stopped, ['inflight-a']);
  assert.deepEqual(bootstrap.listSessions(), ['inflight-b']);
});
