// Business test: Wait and advanced operations
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

test('business: wait pauses execution', async () => {
  await camo(['goto', 'https://example.com']);
  const start = Date.now();
  const r = await camoJson(['wait', '--ms', '300']);
  const elapsed = Date.now() - start;
  assert.equal(r.code, 0, `wait failed: ${r.stderr}`);
  assert.ok(elapsed >= 250, `wait should pause ~300ms, was ${elapsed}ms`);
});

test('business: scroll-and-collect scrolls and gathers elements', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['scroll-and-collect', '--selector', 'p', '--max-scrolls', '2']);
  assert.equal(r.code, 0, `scroll-and-collect failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: set-user-agent changes browser UA', async () => {
  await camo(['goto', 'https://example.com']);
  const ua = 'Mozilla/5.0 TestBrowser/1.0';
  const r = await camoJson(['set-user-agent', '--ua', ua]);
  assert.equal(r.code, 0, `set-user-agent failed: ${r.stderr}`);
});

test('business: set-viewport changes browser viewport', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['set-viewport', '--width', '1280', '--height', '720']);
  assert.equal(r.code, 0, `set-viewport failed: ${r.stderr}`);
});
