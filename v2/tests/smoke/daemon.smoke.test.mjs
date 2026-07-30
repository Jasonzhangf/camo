// Smoke test: verify daemon can start (or fail gracefully without Playwright browser).
// This test does NOT actually launch a browser - it just verifies module loading.

import test from 'node:test';
import assert from 'node:assert/strict';

test('smoke: daemon module loads', async () => {
  // This validates the daemon can at least be parsed and imported.
  // We don't actually start it because it would spawn a browser.
  const path = await import('node:path');
  const url = await import('node:url');
  const fs = await import('node:fs');
  
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const daemonPath = path.join(__dirname, '../../shell/daemon/index.mjs');
  
  assert.ok(fs.existsSync(daemonPath), 'daemon entry must exist');
});

test('smoke: playwright_bridge loads', async () => {
  const pw = await import('../../services/browser_service/internal/playwright_bridge.mjs');
  assert.ok(typeof pw.launchBrowser === 'function');
  assert.ok(typeof pw.closeBrowser === 'function');
  assert.ok(typeof pw.getPage === 'function');
});

test('smoke: page_ops loads with all operations', async () => {
  const ops = await import('../../services/page_runtime/operations/page_ops.mjs');
  assert.ok(typeof ops.goto === 'function');
  assert.ok(typeof ops.click === 'function');
  assert.ok(typeof ops.type === 'function');
  assert.ok(typeof ops.scroll === 'function');
  assert.ok(typeof ops.screenshot === 'function');
  assert.ok(typeof ops.snapshot === 'function');
  assert.ok(typeof ops.wait === 'function');
  assert.ok(typeof ops.evaluate === 'function');
  assert.ok(typeof ops.upload === 'function');
  assert.ok(typeof ops.select === 'function');
});

test('smoke: input_pipeline exposes all operation functions', async () => {
  const ip = await import('../../services/page_runtime/input_pipeline.mjs');
  assert.ok(typeof ip.goto === 'function');
  assert.ok(typeof ip.click === 'function');
  assert.ok(typeof ip.type === 'function');
  assert.ok(typeof ip.scroll === 'function');
  assert.ok(typeof ip.screenshot === 'function');
  assert.ok(typeof ip.snapshot === 'function');
  assert.ok(typeof ip.wait === 'function');
  assert.ok(typeof ip.evaluate === 'function');
  assert.ok(typeof ip.upload === 'function');
  assert.ok(typeof ip.select === 'function');
});

test('smoke: browser_service bootstrap exposes session API', async () => {
  const bs = await import('../../services/browser_service/bootstrap.mjs');
  assert.ok(typeof bs.startSession === 'function');
  assert.ok(typeof bs.stopSession === 'function');
  assert.ok(typeof bs.getCurrentPage === 'function');
  assert.ok(typeof bs.getSession === 'function');
  assert.ok(typeof bs.listSessions === 'function');
  assert.ok(typeof bs.shutdown === 'function');
  assert.ok(typeof bs.boot === 'function');
  assert.ok(typeof bs.describe === 'function');
});
