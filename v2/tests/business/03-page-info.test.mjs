// Business test: Page information retrieval
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

test('business: get-text returns element text', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['get-text', '--selector', 'h1']);
  assert.equal(r.code, 0, `get-text failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: get-readable extracts article text', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['get-readable']);
  assert.equal(r.code, 0, `get-readable failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: find-elements returns matching elements', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['find-elements', '--selector', 'a']);
  assert.equal(r.code, 0, `find-elements failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: evaluate runs JavaScript in page context', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['evaluate', '--script', 'document.title']);
  assert.equal(r.code, 0, `evaluate failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: get-page-info returns URL, title, viewport', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['get-page-info']);
  assert.equal(r.code, 0, `get-page-info failed: ${r.stderr}`);
  assert.ok(r.json);
});
