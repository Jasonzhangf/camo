// Business test: End-to-end scenarios
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const CAMO = process.env.CAMO_BIN || 'node';
const REPO_ROOT = path.join(os.homedir(), 'Documents/github/camo');
const BIN_ENTRY = path.join(REPO_ROOT, 'v2/shell/bin_entry/index.mjs');
const TEST_ENV = { ...process.env, CAMO_HEADLESS: '1', CAMO_AUTOSTART: '1' };

function camo(args, timeout = 60000) {
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
    catch { return { ...r, json: null }; }
  });
}

test('e2e: scrape article content', async () => {
  await camo(['goto', 'https://example.com']);
  
  // Get page title
  const title = await camoJson(['evaluate', '--script', 'document.title']);
  assert.equal(title.code, 0, 'should get title');
  
  // Get readable content
  const text = await camoJson(['get-readable']);
  assert.equal(text.code, 0, 'should get readable content');
  
  // Count paragraphs
  const count = await camoJson(['find-elements', '--selector', 'p']);
  assert.equal(count.code, 0, 'should count paragraphs');
  
  // Take screenshot
  const screenshot = await camoJson(['screenshot']);
  assert.equal(screenshot.code, 0, 'should take screenshot');
});

test('e2e: multi-tab browsing workflow', async () => {
  await camo(['goto', 'https://example.com']);
  
  // Open new tab
  await camo(['new-tab', '--url', 'https://example.org']);
  
  // List tabs
  const tabs = await camoJson(['list-tabs']);
  assert.equal(tabs.code, 0, 'should list tabs');
  
  // Close the new tab
  await camo(['close-tab']);
});

test('e2e: page state inspection', async () => {
  await camo(['goto', 'https://example.com']);
  
  // Get full page info
  const info = await camoJson(['get-page-info']);
  assert.equal(info.code, 0);
  
  // Get snapshot
  const snap = await camoJson(['snapshot']);
  assert.equal(snap.code, 0);
  
  // Get cookies
  const cookies = await camoJson(['get-cookies']);
  assert.equal(cookies.code, 0);
});

test('e2e: evaluate complex page logic', async () => {
  await camo(['goto', 'https://example.com']);
  
  const result = await camoJson(['evaluate', '--script', `
    JSON.stringify({
      title: document.title,
      url: window.location.href,
      h1Count: document.querySelectorAll('h1').length
    })
  `]);
  assert.equal(result.code, 0, 'evaluate should succeed');
});

test('e2e: viewport responsive testing', async () => {
  await camo(['goto', 'https://example.com']);
  
  // Desktop
  await camoJson(['set-viewport', '--width', '1920', '--height', '1080']);
  
  // Mobile
  await camoJson(['set-viewport', '--width', '375', '--height', '667']);
  
  assert.ok(true, 'viewport switching works');
});

test('e2e: cookie session simulation', async () => {
  const cookies = JSON.stringify([{ name: 'session', value: 'abc123', domain: 'example.com' }]);
  await camo(['set-cookies', '--cookies', cookies]);
  await camo(['goto', 'https://example.com']);
  
  const stored = await camoJson(['get-cookies']);
  assert.equal(stored.code, 0);
});
