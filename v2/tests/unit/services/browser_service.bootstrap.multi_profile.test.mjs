import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-bootstrap-locks-'));
const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-bootstrap-runs-'));
process.env.CAMO_LOCK_ROOT = lockRoot;
process.env.CAMO_PATHS_RUNS = runsRoot;

const bootstrap = await import('../../../services/browser_service/bootstrap.mjs');
const lockManager = await import('../../../services/lock/manager.mjs');
const bridge = await import('../../../services/browser_service/internal/camoufox_bridge.mjs');
const session = await import('../../../services/session/manager.mjs');
const progressLog = await import('../../../services/progress_event/log.mjs');

progressLog.__enableTestRoot();
progressLog.__setRunsRootForTest(runsRoot);

test.after(() => {
  fs.rmSync(lockRoot, { recursive: true, force: true });
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

test('positive: shutdown releases every profile-owned lock', async () => {
  bootstrap.__enableTestRoot();
  await bootstrap.enableAllOwners();
  lockManager.__enableTestRoot();
  lockManager.__setLocksRootForTest(lockRoot);
  bridge.__enableTestRoot();
  session.__enableTestRoot();

  const owner = `browser-service-${process.pid}`;
  lockManager.acquire('multi-a', { owner, pid: process.pid, mode: 'F' });
  lockManager.acquire('multi-b', { owner, pid: process.pid, mode: 'F' });
  bridge.__setBrowserForTest('multi-a', { context: { async close() {} }, lock: { release() {} } });
  bridge.__setBrowserForTest('multi-b', { context: { async close() {} }, lock: { release() {} } });

  bootstrap.__setOwnedProfilesForTest(['multi-a', 'multi-b']);
  await bootstrap.shutdown();

  assert.equal(fs.existsSync(path.join(lockRoot, 'multi-a', 'lock.json')), false);
  assert.equal(fs.existsSync(path.join(lockRoot, 'multi-b', 'lock.json')), false);
});

test('negative: targeted stop does not release another profile lock', async () => {
  bootstrap.__enableTestRoot();
  await bootstrap.enableAllOwners();
  lockManager.__enableTestRoot();
  lockManager.__setLocksRootForTest(lockRoot);
  lockManager.acquire('target-a', { owner: `browser-service-${process.pid}`, pid: process.pid, mode: 'F' });
  lockManager.acquire('target-b', { owner: `browser-service-${process.pid}`, pid: process.pid, mode: 'F' });
  bridge.__setBrowserForTest('target-a', { context: { async close() {} }, lock: { release() {} } });
  bridge.__setBrowserForTest('target-b', { context: { async close() {} }, lock: { release() {} } });
  bootstrap.__setOwnedProfilesForTest(['target-a', 'target-b']);

  await bootstrap.stopSession('target-a');

  assert.equal(fs.existsSync(path.join(lockRoot, 'target-a', 'lock.json')), false);
  assert.equal(fs.existsSync(path.join(lockRoot, 'target-b', 'lock.json')), true);
  await bootstrap.__resetForTest();
});
