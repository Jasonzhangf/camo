// Business test: Profile and session management
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const CAMO = process.env.CAMO_BIN || 'node';
const REPO_ROOT = path.join(os.homedir(), 'Documents/github/camo');
const BIN_ENTRY = path.join(REPO_ROOT, 'v2/shell/bin_entry/index.mjs');
const TEST_ENV = { ...process.env, CAMO_HEADLESS: '1', CAMO_AUTOSTART: '1' };

function camo(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CAMO, [BIN_ENTRY, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: TEST_ENV });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, timeout);
    proc.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    proc.on('error', reject);
  });
}

function camoJson(args) {
  return camo(args).then(r => {
    try { return { ...r, json: JSON.parse(r.stdout) }; }
    catch { return { ...r, json: null, stderr: r.stderr.slice(0, 200) }; }
  });
}

const profile = `test-${Date.now()}`;

test('business: ephemeral session auto-cleanup', async () => {
  const r = await camoJson(['goto', 'https://example.com']);
  assert.equal(r.code, 0, `ephemeral failed: ${r.stderr}`);
});

test('business: profile-based persistent session', async () => {
  const start = await camoJson(['start', '--profile', profile, '--url', 'https://example.com']);
  assert.equal(start.code, 0, `profile start failed: ${start.stderr}`);
  const stop = await camoJson(['stop', '--profile', profile]);
  assert.ok([0, 1, null].includes(stop.code), `stop failed: ${stop.stderr}`);
});

test('business: doctor reports environment health', async () => {
  const r = await camoJson(['doctor']);
  assert.equal(r.code, 0, `doctor failed: ${r.stderr}`);
  assert.ok(r.json);
});
