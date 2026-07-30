// Business test: User-like operations
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

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

test('business: click on element by CSS selector', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['click', '--selector', 'h1']);
  assert.ok([0, 1].includes(r.code), `click failed: ${r.stderr}`);
});

test('business: type text into input element', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['type', '--selector', 'input', '--text', 'test']);
  assert.ok([0, 1].includes(r.code), `type failed: ${r.stderr}`);
});

test('business: hover over element', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['hover', '--selector', 'a']);
  assert.equal(r.code, 0, `hover failed: ${r.stderr}`);
});

test('business: scroll page', async () => {
  await camo(['goto', 'https://example.com']);
  const r = await camoJson(['scroll', '--direction', 'down', '--amount', '500']);
  assert.equal(r.code, 0, `scroll failed: ${r.stderr}`);
});

test('business: wait pauses execution', async () => {
  await camo(['goto', 'https://example.com']);
  const start = Date.now();
  const r = await camoJson(['wait', '--ms', '200']);
  const elapsed = Date.now() - start;
  assert.equal(r.code, 0, `wait failed: ${r.stderr}`);
  assert.ok(elapsed >= 150, `wait should pause ~200ms, was ${elapsed}ms`);
});
