import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as lock from '../../../services/lock/manager.mjs';
import { getProcessIdentity } from '../../../services/daemon_registration/registry.mjs';

lock.__enableTestRoot();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-lock-identity-'));
lock.__setLocksRootForTest(root);

function lockPath(profileId) {
  return path.join(root, profileId, 'lock.json');
}

function writeHolder(profileId, pid, processIdentity, owner = 'holder') {
  const file = lockPath(profileId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    pid,
    owner,
    profileId,
    acquiredAt: new Date().toISOString(),
    mode: 'F',
    processIdentity,
  }, null, 2), 'utf8');
}

function spawnLiveHolder() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  assert.ok(child.pid);
  process.kill(child.pid, 0);
  return child;
}

function identityOrSkip(t, pid) {
  try {
    return getProcessIdentity(pid);
  } catch (cause) {
    t.skip(`process identity unavailable: ${cause?.message || cause}`);
    return null;
  }
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('positive: stale cleanup removes only lock.json and preserves profile data', () => {
  const profileId = 'cleanup-retains-data';
  const profileDir = path.join(root, profileId);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cookies.sqlite'), 'cookies', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'fingerprint.json'), '{}', 'utf8');
  lock.acquire(profileId, { owner: 'dead', pid: 999_999_991 });

  assert.deepEqual(lock.cleanupStale(), [profileId]);
  assert.equal(fs.existsSync(lockPath(profileId)), false);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cookies.sqlite'), 'utf8'), 'cookies');
  assert.equal(fs.existsSync(path.join(profileDir, 'fingerprint.json')), true);
});

test('negative: live holder with matching generation remains the owner', (t) => {
  const holder = spawnLiveHolder();
  try {
    const identity = identityOrSkip(t, holder.pid);
    if (!identity) return;
    writeHolder('live-generation', holder.pid, identity);
    assert.throws(
      () => lock.acquire('live-generation', { owner: 'contender', pid: process.pid }),
      (cause) => cause?.code === 'E_STATE_LOCKED',
    );
    process.kill(holder.pid, 0);
    assert.equal(JSON.parse(fs.readFileSync(lockPath('live-generation'), 'utf8')).pid, holder.pid);
  } finally {
    holder.kill('SIGTERM');
  }
});

test('positive: reused PID generation is reclaimed without killing the live process', (t) => {
  const holder = spawnLiveHolder();
  try {
    if (!identityOrSkip(t, holder.pid)) return;
    writeHolder('reused-generation', holder.pid, 'stale:generation');
    const acquired = lock.acquire('reused-generation', { owner: 'contender', pid: process.pid });
    assert.equal(acquired.pid, process.pid);
    process.kill(holder.pid, 0);
    lock.release('reused-generation', { owner: 'contender', pid: process.pid });
  } finally {
    holder.kill('SIGTERM');
  }
});

test('negative: live holder with self-only identity fails closed', () => {
  const holder = spawnLiveHolder();
  try {
    writeHolder('fallback-generation', holder.pid, `fallback:${holder.pid}:opaque`);
    assert.throws(
      () => lock.acquire('fallback-generation', { owner: 'contender', pid: process.pid }),
      (cause) => cause?.code === 'E_STATE_LOCKED',
    );
    process.kill(holder.pid, 0);
  } finally {
    holder.kill('SIGTERM');
  }
});

test('negative: legacy same-pid lock without generation does not become reentrant', () => {
  writeHolder('legacy-same-pid', process.pid, null, 'browser-service');
  assert.throws(
    () => lock.acquire('legacy-same-pid', { owner: 'browser-service', pid: process.pid }),
    (cause) => cause?.code === 'E_STATE_LOCKED',
  );
});

test('negative: concurrent acquires yield exactly one owner', async () => {
  const moduleUrl = new URL('../../../services/lock/manager.mjs', import.meta.url).href;
  const source = [
    `import * as lock from ${JSON.stringify(moduleUrl)};`,
    'const [profileId, root, startAt] = process.argv.slice(1);',
    'lock.__enableTestRoot();',
    'lock.__setLocksRootForTest(root);',
    'while (Date.now() < Number(startAt)) {}',
    'let acquired = false;',
    'try { lock.acquire(profileId, { owner: `worker-${process.pid}`, pid: process.pid }); acquired = true; } catch {}',
    "process.stdout.write(JSON.stringify({ acquired }) + '\\n');",
    'if (acquired) setTimeout(() => lock.release(profileId, { owner: `worker-${process.pid}`, pid: process.pid }), 250);',
  ].join('\n');
  const startAt = Date.now() + 250;
  const children = [0, 1].map(() => spawn(process.execPath, [
    '--input-type=module', '-e', source, 'concurrent', root, String(startAt),
  ], { stdio: ['ignore', 'pipe', 'pipe'] }));
  const results = await Promise.all(children.map((child) => new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve(JSON.parse(stdout.trim()));
    });
  })));
  assert.equal(results.filter((result) => result.acquired).length, 1);
});
