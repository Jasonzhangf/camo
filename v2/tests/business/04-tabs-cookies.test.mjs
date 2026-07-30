// Business test: Tabs and Cookies operations
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

test('business: list-tabs shows current tabs', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['list-tabs']);
  assert.equal(r.code, 0, `list-tabs failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: new-tab opens additional tab', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['new-tab', '--url', 'https://example.org']);
  assert.equal(r.code, 0, `new-tab failed: ${r.stderr}`);
});

test('business: get-cookies returns browser cookies', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['get-cookies']);
  assert.equal(r.code, 0, `get-cookies failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: set-cookies sets browser cookies', async () => {
  await camo(['goto', 'https://example.com']);
  const cookies = JSON.stringify([{ name: 'test', value: 'value', domain: 'example.com' }]);
  const r = await camoJson(['set-cookies', '--cookies', cookies]);
  assert.equal(r.code, 0, `set-cookies failed: ${r.stderr}`);
});
