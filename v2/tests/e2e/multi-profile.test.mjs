// E2E shared-daemon truth: profile selection must not create a second daemon.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = path.join(__dirname, '..', '..', 'shell', 'daemon', 'index.mjs');
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-e2e-shared-daemon-'));
process.env.HOME = TEST_HOME;
const { findActiveDaemon, listRegistrations } = await import('../../services/daemon_registration/registry.mjs');

function readReg(pid) {
  return listRegistrations({ includeStale: true }).find((registration) => registration.pid === pid) || null;
}

async function waitForRegistration(pid, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const reg = readReg(pid);
    if (reg) return reg;
    await wait(100);
  }
  throw new Error(`daemon ${pid} did not register`);
}

test('e2e: different profiles still have one shared daemon owner', { skip: process.env.CAMO_E2E_SKIP === '1' }, async (t) => {
  const profileA = `multi-A-${Date.now()}`;
  const profileB = `multi-B-${Date.now()}`;

  const a = spawn(process.execPath, [DAEMON_SCRIPT, '--profile', profileA], {
    env: { ...process.env, HOME: TEST_HOME, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const b = spawn(process.execPath, [DAEMON_SCRIPT, '--profile', profileB], {
    env: { ...process.env, HOME: TEST_HOME, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    for (const c of [a, b]) {
      if (!c.killed) try { c.kill('SIGTERM'); } catch {}
    }
  });

  const exited = await Promise.all([
    new Promise((resolve) => a.on('exit', (code) => resolve({ child: a, code }))),
    new Promise((resolve) => b.on('exit', (code) => resolve({ child: b, code }))),
  ].map(async (exitPromise) => Promise.race([
    exitPromise,
    wait(1000).then(() => null),
  ])));
  const loser = exited.find(Boolean);
  const winner = loser?.child === a ? b : a;
  assert.ok(loser, 'one daemon must reject the duplicate shared claim');
  assert.notEqual(loser.code, 0);
  const registration = await waitForRegistration(winner.pid);
  assert.equal(registration.pid, winner.pid);
  assert.equal(findActiveDaemon()?.pid, winner.pid);
  assert.equal(listRegistrations().length, 1);

  winner.kill('SIGTERM');
  await new Promise((resolve) => winner.on('exit', resolve));
  await wait(200);
  assert.equal(readReg(winner.pid), null);
});
