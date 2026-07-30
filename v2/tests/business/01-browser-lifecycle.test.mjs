// Business test: Browser lifecycle operations
// Tests: start, goto, snapshot, screenshot, stop

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CAMO = process.env.CAMO_BIN || 'node';
const REPO_ROOT = path.join(os.homedir(), 'Documents/github/camo');
const BIN_ENTRY = path.join(REPO_ROOT, 'v2/shell/bin_entry/index.mjs');
const TEST_URL = 'https://example.com';

// Enable autostart daemon
const TEST_ENV = { ...process.env, CAMO_HEADLESS: '1', CAMO_AUTOSTART: '1' };

function camo(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CAMO, [BIN_ENTRY, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: TEST_ENV
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('timeout'));
    }, timeout);
    proc.on('exit', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', reject);
  });
}

function camoJson(args, timeout = 60000) {
  return camo(args, timeout).then(r => {
    try {
      return { ...r, json: JSON.parse(r.stdout) };
    } catch {
      return { ...r, json: null, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) };
    }
  });
}

test('business: doctor reports environment health', async () => {
  const r = await camoJson(['doctor']);
  assert.equal(r.code, 0, `doctor failed: ${r.stderr}`);
  assert.ok(r.json, 'doctor should return JSON');
  assert.ok(r.json.node || r.json.registry, 'should have health info');
});

test('business: start launches browser and returns session', async () => {
  const r = await camoJson(['start', '--url', TEST_URL], 30000);
  assert.equal(r.code, 0, `start failed: ${r.stderr}\nstdout: ${r.stdout}`);
  assert.ok(r.json, 'should return JSON');
});

test('business: goto navigates to URL', async () => {
  const r = await camoJson(['goto', TEST_URL], 30000);
  assert.equal(r.code, 0, `goto failed: ${r.stderr}\nstdout: ${r.stdout}`);
  assert.ok(r.json);
});

test('business: get-page-info returns URL and title', async () => {
  await camo(['goto', TEST_URL]);
  const r = await camoJson(['get-page-info']);
  assert.equal(r.code, 0, `get-page-info failed: ${r.stderr}`);
  assert.ok(r.json);
  assert.ok(r.json.url || r.json.title || r.json.status, 'should have page info');
});

test('business: snapshot captures page state', async () => {
  await camo(['goto', TEST_URL]);
  const snap = await camoJson(['snapshot']);
  assert.equal(snap.code, 0, `snapshot failed: ${snap.stderr}`);
  assert.ok(snap.json, 'snapshot should return JSON');
});

test('business: screenshot captures image', async () => {
  await camo(['goto', TEST_URL]);
  const snap = await camoJson(['screenshot']);
  assert.equal(snap.code, 0, `screenshot failed: ${snap.stderr}`);
  assert.ok(snap.json, 'screenshot should return JSON');
});

test('business: find-elements returns matching elements', async () => {
  await camo(['goto', TEST_URL]);
  const r = await camoJson(['find-elements', '--selector', 'a']);
  assert.equal(r.code, 0, `find-elements failed: ${r.stderr}`);
  assert.ok(r.json);
});

test('business: evaluate runs JavaScript in page', async () => {
  await camo(['goto', TEST_URL]);
  const r = await camoJson(['evaluate', '--script', 'document.title']);
  assert.equal(r.code, 0, `evaluate failed: ${r.stderr}`);
  assert.ok(r.json);
});
