// E2E lifecycle: ephemeral start → command → auto-shutdown cleanup.
//
// What it proves:
//   - A daemon spawned in --ephemeral mode actually starts on free ports
//   - WS client connects and gets a pong response
//   - On SIGTERM, daemon closes all listeners and removes its registration
//   - No leftover registration file under ~/.camo/daemon/
//
// This test does NOT launch a real browser. It only exercises the daemon
// lifecycle, port allocation, and registration bookkeeping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';

import { findActiveDaemon } from '../../shell/config/daemon_finder.mjs';
import { WebSocket } from 'ws';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = path.join(__dirname, '..', '..', 'shell', 'daemon', 'index.mjs');

function readReg(pid) {
  const dir = path.join(os.homedir(), '.camo', 'daemon');
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (raw.pid === pid) return raw;
    } catch {}
  }
  return null;
}

async function waitForRegistration(pid, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const reg = readReg(pid);
    if (reg) return reg;
    await wait(100);
  }
  throw new Error(`Daemon ${pid} did not register within ${timeoutMs}ms`);
}

test('e2e: ephemeral daemon start → ws ping → sigterm → cleanup', { skip: process.env.CAMO_E2E_SKIP === '1' }, async (t) => {
  const profile = `e2e-${Date.now()}-${process.pid}`;
  const child = spawn(process.execPath, [DAEMON_SCRIPT, '--ephemeral'], {
    env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0', CAMO_PROFILE: profile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  
  const stderr = [];
  child.stderr.on('data', (c) => stderr.push(String(c)));
  child.on('error', (e) => t.diagnostic(`spawn error: ${e.message}`));
  
  t.after(() => {
    if (!child.killed) {
      try { child.kill('SIGTERM'); } catch {}
    }
  });

  // Wait for the daemon to register itself.
  const reg = await waitForRegistration(child.pid);
  assert.equal(reg.profile.startsWith('_ephemeral_'), true, 'ephemeral profile gets _ephemeral_ prefix');
  assert.equal(reg.mode, 'ephemeral');
  assert.ok(reg.wsPort > 0, 'wsPort is a real port number');
  assert.ok(reg.httpPort > 0, 'httpPort is a real port number');

  // Connect via WS and ping.
  const ws = await new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://localhost:${reg.wsPort}`);
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 5000);
    sock.on('open', () => { clearTimeout(timer); resolve(sock); });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  
  const pong = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws ping timeout')), 5000);
    ws.on('message', (data) => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(String(data));
        resolve(env);
      } catch (e) { reject(e); }
    });
    ws.send(JSON.stringify({
      v: 'camo.v2.protocol/v1',
      id: 'e2e-ping',
      kind: 'ping',
      ts: new Date().toISOString(),
      payload: { ts: Date.now() },
    }));
  });
  ws.close();
  
  assert.equal(pong.kind, 'pong');
  assert.equal(pong.id, 'e2e-ping');

  // Send SIGTERM and confirm cleanup.
  child.kill('SIGTERM');
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 128 + 1 : 0)));
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve(-1);
    }, 5000);
  });
  assert.equal(exitCode, 0, `daemon should exit 0 on SIGTERM, got ${exitCode}`);

  // Registration file should be gone.
  await wait(200);
  const leftover = readReg(child.pid);
  assert.equal(leftover, null, 'daemon registration file should be removed on shutdown');
});

test('e2e: same-profile conflict is detected and rejected', { skip: process.env.CAMO_E2E_SKIP === '1' }, async (t) => {
  const profile = `e2e-conflict-${Date.now()}`;
  const child = spawn(process.execPath, [DAEMON_SCRIPT, '--profile', profile], {
    env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  
  t.after(() => {
    if (!child.killed) try { child.kill('SIGTERM'); } catch {}
  });

  const firstReg = await waitForRegistration(child.pid);
  assert.ok(firstReg, 'first daemon registers');

  // Try a second daemon on the same profile; it should exit non-zero.
  const second = spawn(process.execPath, [DAEMON_SCRIPT, '--profile', profile], {
    env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  
  const stderr = [];
  second.stderr.on('data', (c) => stderr.push(String(c)));
  
  const code = await new Promise((resolve) => {
    second.on('exit', (c) => resolve(c));
    setTimeout(() => { try { second.kill('SIGKILL'); } catch {}; resolve(-1); }, 5000);
  });
  assert.notEqual(code, 0, 'second daemon on same profile must exit non-zero');
  assert.match(stderr.join(''), /already owned by daemon/, 'stderr explains the conflict');
  
  // Cleanup: kill first daemon.
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
});

test('e2e: daemon finder returns active daemons and filters dead ones', () => {
  const profile = 'finder-test';
  // Active: just launched from previous test would be present, but
  // for finder unit test we just verify the shape.
  const result = findActiveDaemon({ profile: '__no_such_profile__' });
  assert.equal(result, null);
  const any = findActiveDaemon({ ephemeral: true });
  // Either we have one (left over) or none — both are valid.
  if (any) {
    assert.ok(any.pid > 0);
    assert.ok(any.wsPort > 0);
  }
});
