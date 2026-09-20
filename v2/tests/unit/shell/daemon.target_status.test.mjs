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
import * as progressLog from '../../../services/progress_event/log.mjs';
import * as pipeline from '../../../services/page_runtime/input_pipeline.mjs';
import { handleCommand } from '../../../shell/daemon/command_handlers.mjs';

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-target-status-'));
const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-target-status-runs-'));

bootstrap.__enableTestRoot();
await bootstrap.enableAllOwners();
bridge.__enableTestRoot();
session.__enableTestRoot();
profileStore.__enableTestRoot();
lockManager.__enableTestRoot();
progressLog.__enableTestRoot();
pipeline.__enableTestRoot();

profileStore.__setProfilesRootForTest(profileRoot);
lockManager.__setLocksRootForTest(profileRoot);
progressLog.__setRunsRootForTest(runsRoot);
process.env.CAMO_PATHS_PROFILES = profileRoot;

function makePage(label) {
  return {
    label,
    navigations: [],
    url() { return this.navigations.at(-1) || 'about:blank'; },
    async goto(url) { this.navigations.push(url); return { status: () => 200, ok: () => true }; },
    async content() { return `<html>${this.label}</html>`; },
  };
}

function stubRecord(profileId) {
  const page = makePage(profileId);
  return {
    profileId,
    page,
    browser: () => ({ close: async () => {} }),
    context: { pages: () => [page], close: async () => {} },
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

function context(profile) {
  return {
    profile,
    opts: { mode: 'persistent', daemonId: `test-${profile}` },
    ensureBrowser: async () => {},
    ephemeralAllocations: new Map(),
  };
}

test.afterEach(() => {
  bridge.__resetForTest();
  session.__resetForTest();
  pipeline.__resetForTest();
});

test.after(() => {
  bootstrap.__setBrowserLifecycleForTest({});
  delete process.env.CAMO_PATHS_PROFILES;
  fs.rmSync(profileRoot, { recursive: true, force: true });
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

test('positive: repeated start reuses one target and does not navigate without URL', async () => {
  const ctx = context('reuse-target');
  const first = await handleCommand('start', {}, ctx);
  const second = await handleCommand('start', {}, ctx);

  assert.match(first.target, /^t_/);
  assert.equal(second.target, first.target);
  assert.equal(second.reused, true);
  assert.deepEqual(bridge.getPage('reuse-target').navigations, []);
});

test('positive: start URL navigates only the allocated target page', async () => {
  const ctx = context('url-target');
  const started = await handleCommand('start', { url: 'https://example.com/one' }, ctx);
  const target = await bootstrap.resolveTarget({ target: started.target, profileId: 'url-target' });

  assert.equal(target.targetId, started.target);
  assert.deepEqual(bridge.getPage('url-target').navigations, ['https://example.com/one']);
});

test('negative: stale target after stop is explicit invalid', async () => {
  const ctx = context('stale-target');
  const started = await handleCommand('start', {}, ctx);
  await handleCommand('stop', {}, ctx);

  await assert.rejects(
    () => handleCommand('goto', { target: started.target, url: 'https://example.com' }, ctx),
    (error) => error.code === 'E_STATE_INVALID' && /stale/.test(error.details.reason),
  );
});

test('positive: status projects sessions and targets without touching updatedAt', async () => {
  const ctx = context('status-readonly');
  const started = await handleCommand('start', {}, ctx);
  const before = (await bootstrap.getSession('status-readonly')).updatedAt;
  const target = await bootstrap.resolveTarget({ profileId: 'status-readonly' });
  const urlBefore = target.page.url();
  const progressBefore = progressLog.readRecent('anonymous').length;

  const status = await handleCommand('status', {}, ctx);

  assert.equal(status.service.state, 'available');
  assert.equal(status.targets[0].target, started.target);
  assert.equal(status.profiles[0].profile, 'status-readonly');
  assert.equal((await bootstrap.getSession('status-readonly')).updatedAt, before);
  assert.equal(target.page.url(), urlBefore, 'status must not mutate the page URL');
  assert.equal(
    progressLog.readRecent('anonymous').length,
    progressBefore,
    'status must not append progress events',
  );
});

test('positive: status exposes pending cleanup and stale lock truth without mutating it', async () => {
  const ctx = context('status-reclamation');
  await handleCommand('start', { ephemeral: true }, ctx);
  const profile = ctx.ephemeralAllocations.get('status-reclamation');
  bootstrap.clearPendingCleanupsForTest();
  const profileDir = path.join(profileRoot, profile);
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target) === profileDir) {
      throw Object.assign(new Error('cleanup blocked'), { code: 'EACCES' });
    }
    return originalRmSync(target, options);
  };
  try {
    await assert.rejects(
      () => handleCommand('stop', {}, ctx),
      (error) => error.code === 'E_BROWSER_CLEANUP_FAILED'
        && error.details.cleanup.kind === 'delete_temp_profile',
    );
  } finally {
    fs.rmSync = originalRmSync;
  }

  lockManager.acquire('status-stale-lock', { owner: 'dead-owner', pid: 999_999_991 });
  const before = JSON.stringify(bootstrap.listPendingCleanups());
  const status = await handleCommand('status', {}, ctx);

  assert.equal(status.reclamation.pending.length, 1);
  assert.equal(status.reclamation.pending[0].profileId, profile);
  assert.equal(status.reclamation.pending[0].kind, 'delete_temp_profile');
  assert.deepEqual(status.reclamation.staleLocks, ['status-stale-lock']);
  assert.equal(JSON.stringify(bootstrap.listPendingCleanups()), before, 'status must not retry or mutate cleanup truth');
});

test('positive: status distinguishes unknown execution from failed execution', async () => {
  const ctx = context('status-execution');
  await handleCommand('start', {}, ctx);

  const idle = await handleCommand('status', {}, ctx);
  assert.equal(idle.execution[0].outcome, 'unknown');

  const target = await bootstrap.resolveTarget({ profileId: 'status-execution' });
  target.page.content = async () => { throw new Error('snapshot failed'); };
  await assert.rejects(() => handleCommand('snapshot', {}, ctx));

  const failed = await handleCommand('status', {}, ctx);
  assert.equal(failed.execution[0].outcome, 'failed');
  assert.equal(typeof failed.execution[0].lastError, 'string');
  assert.ok(failed.execution[0].lastError.length > 0);
});

test('positive: status reports stale registration projection without changing registration truth', async () => {
  const ctx = context('status-registration');
  const status = await handleCommand('status', {}, ctx);

  assert.ok(Array.isArray(status.reclamation.staleRegistrations));
  assert.deepEqual(status.errors, []);
});

test('negative: same-profile concurrent action is rejected by the pipeline lock', async () => {
  const ctx = context('serialized-target');
  await handleCommand('start', {}, ctx);
  const target = await bootstrap.resolveTarget({ profileId: 'serialized-target' });
  const originalContent = target.page.content;
  let release;
  target.page.content = async function () {
    await new Promise((resolve) => { release = resolve; });
    return originalContent.call(this);
  };

  const first = handleCommand('snapshot', {}, ctx);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(
    () => handleCommand('snapshot', {}, ctx),
    (error) => error.code === 'E_STATE_LOCKED' && error.details.profileId === 'serialized-target',
  );
  release();
  await first;
});

test('negative: explicit target from another profile is not silently rebound', async () => {
  const a = await handleCommand('start', {}, context('target-owner-a'));
  await handleCommand('start', {}, context('target-owner-b'));

  await assert.rejects(
    () => handleCommand('snapshot', { target: a.target }, context('target-owner-b')),
    (error) => error.code === 'E_STATE_INVALID' && /different profile/.test(error.details.reason),
  );
});
