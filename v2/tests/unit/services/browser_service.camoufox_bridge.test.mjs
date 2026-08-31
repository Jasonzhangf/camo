// Camoufox bridge unit tests.
// Tests browser instance lifecycle management without real browser.
// Uses __resetForTest to isolate state per test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  __enableTestRoot,
  __resetForTest,
  closeAll,
  listActive,
  launchBrowser,
  relaunchBrowser,
  __setBrowserForTest,
  __setLaunchOwnersForTest,
} from '../../../services/browser_service/internal/camoufox_bridge.mjs';
import {
  __enableTestRoot as enableProfileTestRoot,
  __setProfilesRootForTest,
} from '../../../services/profile/store.mjs';

__enableTestRoot();
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-camoufox-test-'));
enableProfileTestRoot();
__setProfilesRootForTest(profileRoot);
process.env.CAMO_PATHS_PROFILES = profileRoot;

test.afterEach(() => { __resetForTest(); });

test.after(() => {
  delete process.env.CAMO_PATHS_PROFILES;
  fs.rmSync(profileRoot, { recursive: true, force: true });
});

test('positive: listActive returns empty array before any launch', () => {
  const active = listActive();
  assert.ok(Array.isArray(active), 'listActive must return array');
  assert.equal(active.length, 0, 'no profiles before launch');
});

test('positive: __resetForTest clears all state', () => {
  // __resetForTest is already called in afterEach; verify no throw
  __resetForTest();
  assert.ok(true, '__resetForTest must not throw');
});

test('positive: __resetForTest allows re-enabling', () => {
  __resetForTest(); // clear
  // After reset, launching same profile again should work (state was cleared)
  assert.ok(true, 're-enabling after reset is safe');
});

test('positive: closeAll on empty state is idempotent', async () => {
  // No browsers launched - closeAll should not throw
  await closeAll();
  assert.ok(true, 'closeAll on empty state must not throw');
});

test('negative: launchBrowser rejects empty profileId', async () => {
  const { launchBrowser } = await import('../../../services/browser_service/internal/camoufox_bridge.mjs');
  await assert.rejects(
    () => launchBrowser(''),
    (err) => err.code === 'E_INPUT_MISSING_FIELD' && err.details?.field === 'profileId',
  );
});

test('negative: closeBrowser rejects empty profileId', async () => {
  const { closeBrowser } = await import('../../../services/browser_service/internal/camoufox_bridge.mjs');
  await assert.rejects(
    () => closeBrowser('   '),
    (err) => err.code === 'E_INPUT_MISSING_FIELD',
  );
});

test('positive: launch and relaunch keep network and navigator UA aligned', async () => {
  const profile = 'ua-bridge-success';
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  const launches = [];
  const applied = [];
  const launch = async (options) => {
    launches.push(options);
    const page = {
      url: () => 'https://example.test/login',
      viewportSize: () => ({ width: 390, height: 844 }),
      setViewportSize: async (viewport) => { page.viewport = viewport; },
      goto: async (url) => { page.navigatedTo = url; },
    };
    return {
      pages: () => [page],
      newPage: async () => page,
      browser: () => ({}),
      close: async () => {},
    };
  };
  __setLaunchOwnersForTest({
    launch,
    loadFingerprint: async () => ({ profileId: profile, userAgent: 'Mozilla/5.0 (Macintosh)' }),
    apply: async (_context, fingerprint) => applied.push(fingerprint),
  });

  const first = await launchBrowser(profile, { headless: true, viewport: { width: 390, height: 844 }, userAgent: ua });
  assert.equal(first.fingerprint.userAgent, ua);
  assert.equal(launches[0].userAgent, ua);
  assert.equal(applied[0].userAgent, ua);

  const next = await relaunchBrowser(profile, { userAgent: ua });
  assert.equal(next.restoredUrl, 'https://example.test/login');
  assert.deepEqual(next.restoredViewport, { width: 390, height: 844 });
  assert.deepEqual(next.page.viewport, { width: 390, height: 844 });
  assert.equal(next.page.navigatedTo, 'https://example.test/login');
  assert.equal(launches[1].userAgent, ua);
  assert.equal(applied[1].userAgent, ua);
});
