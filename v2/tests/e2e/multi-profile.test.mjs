// E2E multi-profile isolation: two persistent daemons on different profiles
// coexist; each owns its own profile and port; no conflict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { WebSocket } from 'ws';

import { findActiveDaemon } from '../../shell/config/daemon_finder.mjs';

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
  throw new Error(`daemon ${pid} did not register`);
}

async function ping(wsPort) {
  const ws = await new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://localhost:${wsPort}`);
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    sock.on('open', () => { clearTimeout(t); resolve(sock); });
    sock.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  const reply = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ping timeout')), 5000);
    ws.on('message', (data) => {
      clearTimeout(t);
      try { resolve(JSON.parse(String(data))); } catch (e) { reject(e); }
    });
    ws.send(JSON.stringify({
      v: 'camo.v2.protocol/v1',
      id: 'multi-ping',
      kind: 'ping',
      ts: new Date().toISOString(),
      payload: { ts: Date.now() },
    }));
  });
  ws.close();
  return reply;
}

test('e2e: two persistent daemons on different profiles coexist', { skip: process.env.CAMO_E2E_SKIP === '1' }, async (t) => {
  const profileA = `multi-A-${Date.now()}`;
  const profileB = `multi-B-${Date.now()}`;

  const a = spawn(process.execPath, [DAEMON_SCRIPT, '--profile', profileA], {
    env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const b = spawn(process.execPath, [DAEMON_SCRIPT, '--profile', profileB], {
    env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    for (const c of [a, b]) {
      if (!c.killed) try { c.kill('SIGTERM'); } catch {}
    }
  });

  const regA = await waitForRegistration(a.pid);
  const regB = await waitForRegistration(b.pid);

  assert.notEqual(regA.wsPort, regB.wsPort, 'two daemons get distinct wsPort');
  assert.notEqual(regA.httpPort, regB.httpPort, 'two daemons get distinct httpPort');
  assert.equal(regA.profile, profileA);
  assert.equal(regB.profile, profileB);

  // Both WS endpoints accept pings independently.
  const pongA = await ping(regA.wsPort);
  const pongB = await ping(regB.wsPort);
  assert.equal(pongA.kind, 'pong');
  assert.equal(pongB.kind, 'pong');

  // finder() returns the daemon matching the requested profile.
  const foundA = findActiveDaemon({ profile: profileA });
  const foundB = findActiveDaemon({ profile: profileB });
  assert.ok(foundA && foundA.pid === a.pid);
  assert.ok(foundB && foundB.pid === b.pid);

  // Stop A; B survives.
  a.kill('SIGTERM');
  await new Promise((resolve) => a.on('exit', resolve));
  await wait(200);
  
  assert.equal(readReg(a.pid), null, 'daemon A registration is removed');
  const foundAAfter = findActiveDaemon({ profile: profileA });
  assert.equal(foundAAfter, null, 'A is no longer found');
  assert.ok(findActiveDaemon({ profile: profileB }), 'B still alive after A exits');
});
