// Business test: Error handling
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const CAMO = process.env.CAMO_BIN || 'node';
const REPO_ROOT = path.join(os.homedir(), 'Documents/github/camo');
const BIN_ENTRY = path.join(REPO_ROOT, 'v2/shell/bin_entry/index.mjs');
const TEST_ENV = { ...process.env, CAMO_HEADLESS: '1', CAMO_AUTOSTART: '1' };

function camo(args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CAMO, [BIN_ENTRY, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: TEST_ENV });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => { proc.kill(); resolve({ code: 124, stdout, stderr }); }, timeout);
    proc.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    proc.on('error', reject);
  });
}

function camoJson(args) {
  return camo(args).then(r => {
    try { return { ...r, json: JSON.parse(r.stdout) }; }
    catch { return { ...r, json: null }; }
  });
}

test('business: invalid URL shows error', async () => {
  const r = await camo(['goto', 'not-a-valid-url']);
  assert.ok(r.code !== 0 || r.stderr.includes('error') || r.stderr.includes('Error'), 
    'invalid URL should produce error');
});

test('business: unknown command returns error', async () => {
  const r = await camoJson(['unknown-command-xyz']);
  assert.ok(r.code !== 0, 'unknown command should fail');
});

test('business: empty command shows usage', async () => {
  const r = await camo([]);
  assert.ok(r.stdout.includes('Usage') || r.stdout.includes('usage'), 'empty command should show usage');
});

test('business: malformed cookies JSON returns error', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['set-cookies', '--cookies', 'not valid json']);
  assert.ok(r.code !== 0 || r.json?.code?.startsWith('E_'), 'should return error');
});
