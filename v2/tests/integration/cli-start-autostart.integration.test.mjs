// Real CLI entry replay: `camo start` with no daemon must auto-start the
// daemon, allocate a target, and return that target over the wire.
//
// This drives the actual bin_entry subprocess (not the command handler) with an
// isolated CAMO_PORTABLE_ROOT so the daemon registration, profile storage, and
// run logs never touch the operator's real ~/.camo state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BIN_ENTRY = path.join(ROOT, 'v2', 'shell', 'bin_entry', 'index.mjs');

function resolveCamoufoxExecutable() {
  const explicit = String(process.env.CAMO_EXECUTABLE_PATH || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(os.homedir(), 'Library', 'Caches', 'camoufox', 'Camoufox.app', 'Contents', 'MacOS', 'camoufox'),
    path.join(os.homedir(), '.cache', 'camoufox', 'Camoufox.app', 'Contents', 'MacOS', 'camoufox'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function registrationFor(portableRoot) {
  const file = path.join(portableRoot, '.camo', 'daemon', '.shared-daemon.claim');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.state === 'active' ? raw : null;
}

function runCli(args, portableRoot, executablePath, timeoutMs = 90_000) {
  const out = spawnSync(process.execPath, [BIN_ENTRY, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      CAMO_PORTABLE_ROOT: portableRoot,
      CAMO_RUNS_ROOT: path.join(portableRoot, '.camo-runs-test'),
      CAMO_EXECUTABLE_PATH: executablePath,
      CAMO_HEADLESS: '1',
      CAMO_AUTOSTART: '',
    },
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return out;
}

function httpGetJson(httpPort, pathname) {
  const out = spawnSync(process.execPath, ['-e', `
    const http = require('node:http');
    const req = http.request({ host: '127.0.0.1', port: ${httpPort}, path: ${JSON.stringify(pathname)}, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => process.stdout.write(body));
    });
    req.on('error', () => process.exit(1));
    req.end();
  `], { encoding: 'utf8', timeout: 15_000 });
  if (out.status !== 0) throw new Error(`GET ${pathname} failed\n${out.stderr || ''}`);
  return JSON.parse(out.stdout);
}

function snapshotRuns(portableRoot) {
  const root = path.join(portableRoot, '.camo-runs-test');
  if (!fs.existsSync(root)) return [];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: full, size: fs.statSync(full).size, mtimeMs: fs.statSync(full).mtimeMs });
    }
  }
  walk(root);
  return files.sort((a, b) => a.path < b.path ? -1 : 1);
}

function processTable() {
  if (process.platform === 'win32') return null;
  const out = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  const rows = [];
  for (const line of out.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    rows.push({ pid: Number(parts[0]), ppid: Number(parts[1]) });
  }
  return rows;
}

function countDescendants(rootPid, table) {
  if (!table) return null;
  const children = new Map();
  for (const row of table) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  let count = 0;
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    for (const child of children.get(pid) || []) {
      count += 1;
      queue.push(child);
    }
  }
  return count;
}

function shutdownIsolatedDaemon(portableRoot) {
  const reg = registrationFor(portableRoot);
  if (!reg) return;
  try {
    spawnSync(process.execPath, ['-e', `
      const http = require('node:http');
      const req = http.request({ host: '127.0.0.1', port: ${reg.httpPort}, path: '/shutdown', method: 'POST' }, (res) => {
        res.resume();
        res.on('end', () => process.exit(0));
      });
      req.on('error', () => process.exit(0));
      req.end();
    `], { encoding: 'utf8', timeout: 10_000 });
  } catch {}
  const deadline = Date.now() + 10_000;
  while (registrationFor(portableRoot) && Date.now() < deadline) {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } catch {}
  }
}

test(
  'real CLI: `camo start` auto-starts a daemon and returns a target',
  { skip: resolveCamoufoxExecutable() ? false : 'no Camoufox executable available' },
  async () => {
    const executablePath = resolveCamoufoxExecutable();
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-cli-start-'));
    const profile = `cli-start-${process.pid}`;
    try {
      const before = registrationFor(portableRoot);
      assert.equal(before, null, 'isolated root must not have a daemon before the command');

      const out = runCli(['start', '--profile', profile], portableRoot, executablePath);
      assert.equal(out.status, 0, `camo start failed\nstdout=${out.stdout}\nstderr=${out.stderr}`);

      const result = JSON.parse(out.stdout);
      assert.equal(result.cmd, 'start');
      assert.equal(result.profile, profile);
      assert.match(result.target, /^t_[a-zA-Z0-9_-]+$/, 'start must return a stable target id');
      assert.equal(result.reused, false);

      const reg = registrationFor(portableRoot);
      assert.ok(reg, 'daemon must be registered after auto-start');
      assert.equal(reg.scope, 'shared');
      assert.ok(reg.wsPort > 0 && reg.httpPort > 0);

      const effectiveProfile = result.profile;
      const pageBefore = runCli(
        ['get-page-info', '--target', result.target, '--profile', effectiveProfile],
        portableRoot,
        executablePath,
      );
      assert.equal(pageBefore.status, 0, `get-page-info before status failed\nstdout=${pageBefore.stdout}\nstderr=${pageBefore.stderr}`);
      const pageBeforeJson = JSON.parse(pageBefore.stdout);

      const runsBefore = snapshotRuns(portableRoot);
      const healthBefore = httpGetJson(reg.httpPort, '/health');
      const processBefore = countDescendants(reg.pid, processTable());

      const statusOutA = runCli(['status', '--profile', effectiveProfile], portableRoot, executablePath, 30_000);
      assert.equal(statusOutA.status, 0, `camo status A failed\nstdout=${statusOutA.stdout}\nstderr=${statusOutA.stderr}`);
      const statusA = JSON.parse(statusOutA.stdout);
      assert.equal(statusA.service.state, 'available');
      assert.equal(statusA.targets[0].target, result.target);

      const statusOutB = runCli(['status', '--profile', effectiveProfile], portableRoot, executablePath, 30_000);
      assert.equal(statusOutB.status, 0, `camo status B failed\nstdout=${statusOutB.stdout}\nstderr=${statusOutB.stderr}`);
      const statusB = JSON.parse(statusOutB.stdout);
      assert.equal(statusB.service.state, 'available');
      assert.equal(statusB.targets[0].target, result.target);
      assert.equal(
        statusB.profiles[0].updatedAt,
        statusA.profiles[0].updatedAt,
        'status must not touch session idle update time',
      );
      assert.deepEqual(statusB.reclamation, statusA.reclamation, 'status must not mutate reclamation projection');
      assert.deepEqual(snapshotRuns(portableRoot), runsBefore, 'status must not append progress or command-run files');

      const healthAfter = httpGetJson(reg.httpPort, '/health');
      assert.equal(healthAfter.browserCount, healthBefore.browserCount, 'status must not change browser process count via health');

      const processAfter = countDescendants(reg.pid, processTable());
      if (processBefore !== null && processAfter !== null) {
        assert.equal(processAfter, processBefore, 'status must not add or remove daemon-owned processes');
      }

      const pageAfter = runCli(
        ['get-page-info', '--target', result.target, '--profile', effectiveProfile],
        portableRoot,
        executablePath,
      );
      assert.equal(pageAfter.status, 0, `get-page-info after status failed\nstdout=${pageAfter.stdout}\nstderr=${pageAfter.stderr}`);
      const pageAfterJson = JSON.parse(pageAfter.stdout);
      assert.equal(pageAfterJson.url, pageBeforeJson.url, 'status must not change the page URL');
    } finally {
      shutdownIsolatedDaemon(portableRoot);
      fs.rmSync(portableRoot, { recursive: true, force: true });
    }
  },
);

test('real CLI: `camo status` with no daemon returns unavailable and does not start one', () => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-cli-status-'));
  const executablePath = resolveCamoufoxExecutable()
    || path.join(portableRoot, 'unused-camoufox');
  try {
    const out = runCli(['status'], portableRoot, executablePath, 30_000);
    assert.equal(out.status, 0, `camo status failed\nstdout=${out.stdout}\nstderr=${out.stderr}`);
    const result = JSON.parse(out.stdout);
    assert.equal(result.cmd, 'status');
    assert.equal(result.service.state, 'unavailable');
    assert.deepEqual(result.profiles, []);
    assert.deepEqual(result.targets, []);
    assert.equal(registrationFor(portableRoot), null, 'status must not start a daemon');
  } finally {
    shutdownIsolatedDaemon(portableRoot);
    fs.rmSync(portableRoot, { recursive: true, force: true });
  }
});
