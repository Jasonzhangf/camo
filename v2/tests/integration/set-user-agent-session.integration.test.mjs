import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as bootstrap from '../../services/browser_service/bootstrap.mjs';
import * as bridge from '../../services/browser_service/internal/camoufox_bridge.mjs';
import * as session from '../../services/session/manager.mjs';
import * as profileStore from '../../services/profile/store.mjs';
import * as lockManager from '../../services/lock/manager.mjs';
import * as tabPool from '../../services/page_runtime/tab_pool.mjs';
import * as progressLog from '../../services/progress_event/log.mjs';
import { handleCommand } from '../../shell/daemon/command_handlers.mjs';

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-user-agent-profile-'));
const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-user-agent-runs-'));

bootstrap.__enableTestRoot();
await bootstrap.enableAllOwners();
bridge.__enableTestRoot();
session.__enableTestRoot();
profileStore.__enableTestRoot();
lockManager.__enableTestRoot();
tabPool.__enableTestRoot();
progressLog.__enableTestRoot();
profileStore.__setProfilesRootForTest(profileRoot);
lockManager.__setLocksRootForTest(profileRoot);
progressLog.__setRunsRootForTest(runsRoot);
process.env.CAMO_PATHS_PROFILES = profileRoot;

function stubRecord(profileId) {
  const page = {
    url: () => 'https://example.test/login',
    viewportSize: () => ({ width: 390, height: 844 }),
    goto: async () => ({ status: () => 200, ok: () => true }),
    setViewportSize: async () => {},
  };
  return {
    profileId,
    page,
    context: { pages: () => [page], close: async () => {} },
    fingerprint: {},
    createdAt: new Date().toISOString(),
    headless: true,
  };
}

const launch = async (profileId) => {
  const record = stubRecord(profileId);
  bridge.__setBrowserForTest(profileId, record);
  return record;
};
const close = async (profileId) => bridge.closeBrowser(profileId);
let relaunch = async (profileId, { userAgent }) => ({
  ...stubRecord(profileId),
  restoredUrl: 'https://example.test/login',
  userAgent,
});
const relaunchOwner = (...args) => relaunch(...args);
bootstrap.__setBrowserLifecycleForTest({ launch, close, relaunch: relaunchOwner });

function context(profile) {
  return {
    profile,
    opts: { mode: 'persistent', daemonId: 'user-agent-session-test' },
    ensureBrowser: async () => {},
    ephemeralAllocations: new Map(),
  };
}

async function start(profile) {
  return handleCommand('start', {}, context(profile));
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
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

test('positive: session transition returns exact UA truth', async () => {
  const profile = 'ua-session-success';
  const started = await start(profile);
  let received;
  relaunch = async (profileId, options) => {
    received = { profileId, ...options };
    return { ...stubRecord(profileId), restoredUrl: 'https://example.test/login' };
  };

  const result = await handleCommand(
    'set-user-agent',
    { target: started.target, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
    context(profile),
  );

  assert.deepEqual(received, {
    profileId: profile,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  });
  assert.equal(result.ok, true);
  assert.equal(result.set, true);
  assert.equal(result.userAgent, received.userAgent);
  assert.equal(result.previousTarget, started.target);
  assert.match(result.target, /^t_/);
  assert.notEqual(result.target, started.target);
  await handleCommand('stop', {}, context(profile));
});

test('negative: failed transition clears browser, session, and lock truth', async () => {
  const profile = 'ua-session-failure';
  const started = await start(profile);
  relaunch = async () => { throw new Error('context launch failed'); };

  await assert.rejects(
    () => handleCommand('set-user-agent', { target: started.target, userAgent: 'Mozilla/5.0 (iPhone)' }, context(profile)),
    (cause) => cause?.code === 'E_BROWSER_SETUSERAGENT_FAILED',
  );
  assert.deepEqual(bridge.listActive(), []);
  assert.deepEqual(bootstrap.listSessions(), []);
  assert.equal(lockManager.probe(profile).held, false);
});

test('negative: concurrent same-profile transitions are serialized', async () => {
  const profile = 'ua-session-serialized';
  const started = await start(profile);
  let release;
  relaunch = async () => new Promise((resolve) => { release = resolve; });
  const first = handleCommand('set-user-agent', { target: started.target, userAgent: 'Mozilla/5.0 (iPhone)' }, context(profile));
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    () => handleCommand('set-user-agent', { target: started.target, userAgent: 'Mozilla/5.0 (Android)' }, context(profile)),
    (cause) => cause?.code === 'E_STATE_LOCKED',
  );
  release({ ...stubRecord(profile), restoredUrl: 'https://example.test/login' });
  await first;
  await handleCommand('stop', {}, context(profile));
});
