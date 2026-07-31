import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

function runClaim(home) {
  const script = `
    import { claimDaemonSlot, releaseDaemonSlot } from './v2/services/daemon_registration/registry.mjs';
    try {
      const claim = claimDaemonSlot();
      process.stdout.write(JSON.stringify({ status: 'claimed', pid: process.pid }) + '\\n');
      setTimeout(() => {
        releaseDaemonSlot(claim);
        process.exit(0);
      }, 1200);
    } catch (cause) {
      process.stdout.write(JSON.stringify({ status: 'rejected', code: cause?.code }) + '\\n');
      process.exit(2);
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    child,
    done: new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    }),
  };
}

function runConcurrentDaemonStarts(home) {
  const script = `
    import { run } from './v2/commands/builtins/daemon.mjs';
    const parsed = (profile) => ({ positional: ['start'], profile, named: {} });
    const settled = await Promise.allSettled([
      run(null, parsed('concurrent-a')),
      run(null, parsed('concurrent-b')),
    ]);
    const results = settled.map((entry) => entry.status === 'fulfilled'
      ? { status: 'fulfilled', value: entry.value }
      : {
          status: 'rejected',
          reason: {
            code: entry.reason?.code,
            details: entry.reason?.details,
          },
        });
    const stop = await run(null, { positional: ['stop'], profile: 'concurrent-a', named: {} });
    process.stdout.write(JSON.stringify({ results, stop }) + '\\n');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, CAMO_HEADLESS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    child,
    done: new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    }),
  };
}

test('negative: concurrent shared daemon claims have exactly one winner', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-claim-'));
  const first = runClaim(home);
  const second = runClaim(home);
  const claimFile = path.join(home, '.camo', 'daemon', '.shared-daemon.claim');
  const partialReads = [];
  const reader = setInterval(() => {
    if (!fs.existsSync(claimFile)) return;
    try {
      const claim = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
      if (!claim.token || !claim.processIdentity || !claim.state) partialReads.push(claim);
    } catch (cause) {
      partialReads.push(cause.message);
    }
  }, 1);
  t.after(() => {
    clearInterval(reader);
    for (const run of [first, second]) {
      if (run.child.exitCode === null) run.child.kill('SIGTERM');
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const results = await Promise.all([first.done, second.done]);
  clearInterval(reader);
  const payloads = results.map((result) => JSON.parse(result.stdout.trim()));
  assert.equal(payloads.filter((payload) => payload.status === 'claimed').length, 1);
  assert.deepEqual(
    payloads.filter((payload) => payload.status === 'rejected').map((payload) => payload.code),
    ['E_STATE_DUPLICATE'],
  );
  assert.deepEqual(partialReads, [], 'canonical claim must never expose partial JSON');
  assert.equal(fs.existsSync(path.join(home, '.camo', 'daemon', '.shared-daemon.claim')), false);
});

test('negative: concurrent stale-claim takeover has one recovery winner', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-stale-claim-'));
  const daemonDir = path.join(home, '.camo', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, '.shared-daemon.claim'), JSON.stringify({
    state: 'claimed',
    pid: 2147483647,
    processIdentity: 'dead:process',
    token: 'stale-owner-token',
    claimedAt: '2026-01-01T00:00:00.000Z',
  }));

  const first = runClaim(home);
  const second = runClaim(home);
  t.after(() => {
    for (const run of [first, second]) {
      if (run.child.exitCode === null) run.child.kill('SIGTERM');
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const results = await Promise.all([first.done, second.done]);
  const payloads = results.map((result) => JSON.parse(result.stdout.trim()));
  assert.equal(payloads.filter((payload) => payload.status === 'claimed').length, 1);
  assert.deepEqual(
    payloads.filter((payload) => payload.status === 'rejected').map((payload) => payload.code),
    ['E_STATE_DUPLICATE'],
  );
  assert.equal(fs.existsSync(path.join(daemonDir, '.shared-daemon.recovery')), false);
  assert.equal(fs.existsSync(path.join(daemonDir, '.shared-daemon.claim')), false);
});

test('positive: stale recovery owner cannot permanently block daemon takeover', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-stale-recovery-'));
  const daemonDir = path.join(home, '.camo', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, '.shared-daemon.claim'), JSON.stringify({
    state: 'claimed',
    pid: 2147483647,
    processIdentity: 'dead:daemon',
    token: 'stale-daemon-token',
    claimedAt: '2026-01-01T00:00:00.000Z',
  }));
  fs.writeFileSync(path.join(daemonDir, '.shared-daemon.recovery'), JSON.stringify({
    state: 'claimed',
    pid: 2147483646,
    processIdentity: 'dead:recovery',
    token: 'stale-recovery-token',
    claimedAt: '2026-01-01T00:00:00.000Z',
    observedToken: 'stale-daemon-token',
  }));
  const staleMutex = path.join(daemonDir, '.shared-daemon.recovery.mutex.lock');
  fs.mkdirSync(staleMutex);
  const staleAt = new Date(Date.now() - 10_000);
  fs.utimesSync(staleMutex, staleAt, staleAt);

  const run = runClaim(home);
  t.after(() => {
    if (run.child.exitCode === null) run.child.kill('SIGTERM');
    fs.rmSync(home, { recursive: true, force: true });
  });

  const completed = await run.done;
  assert.equal(completed.code, 0, completed.stderr);
  assert.equal(JSON.parse(completed.stdout.trim()).status, 'claimed');
  assert.equal(fs.existsSync(path.join(daemonDir, '.shared-daemon.recovery')), false);
  assert.equal(fs.existsSync(staleMutex), false);
  assert.equal(fs.existsSync(path.join(daemonDir, '.shared-daemon.claim')), false);
});

test('negative: concurrent daemon starts never project loser pid with winner ports', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-start-race-'));
  const run = runConcurrentDaemonStarts(home);
  t.after(() => {
    if (run.child.exitCode === null) run.child.kill('SIGTERM');
    fs.rmSync(home, { recursive: true, force: true });
  });

  const completed = await run.done;
  assert.equal(completed.code, 0, completed.stderr);
  const payload = JSON.parse(completed.stdout.trim());
  const started = payload.results.filter(
    (entry) => entry.status === 'fulfilled' && entry.value.status === 'started',
  );
  const alreadyRunning = payload.results.filter(
    (entry) => entry.status === 'fulfilled' && entry.value.status === 'already_running',
  );
  const rejectedDuplicates = payload.results.filter(
    (entry) => entry.status === 'rejected' && entry.reason.code === 'E_STATE_DUPLICATE',
  );

  assert.equal(started.length, 1);
  assert.equal(alreadyRunning.length + rejectedDuplicates.length, 1);
  assert.equal(payload.stop.status, 'stopped');
  assert.equal(
    fs.existsSync(path.join(home, '.camo', 'daemon', '.shared-daemon.claim')),
    false,
  );
  const daemonDir = path.join(home, '.camo', 'daemon');
  assert.equal(fs.existsSync(path.join(daemonDir, '.shared-daemon.recovery')), false);
});
