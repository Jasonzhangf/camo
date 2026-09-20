import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('browser service has no external current-page projection', () => {
  const source = read('v2/services/browser_service/bootstrap.mjs');
  assert.doesNotMatch(source, /export\s+function\s+getCurrentPage\b/);
});

test('camoufox bridge has no caller-visible tab-index switch surface', () => {
  const source = read('v2/services/browser_service/internal/camoufox_bridge.mjs');
  assert.doesNotMatch(source, /export\s+function\s+getTabPages\b/);
  assert.doesNotMatch(source, /export\s+async\s+function\s+switchPage\b/);
  assert.doesNotMatch(source, /\btabId\b/);
});

test('browser commands resolve target before page-runtime dispatch', () => {
  const source = read('v2/shell/daemon/command_handlers.mjs');
  assert.match(source, /async function resolveTarget\b/);
  assert.match(source, /withTargetArgs\(target/);
  assert.doesNotMatch(source, /getCurrentPage/);
  assert.doesNotMatch(source, /switchPage/);
});

test('page runtime does not accept a caller-visible page switch operation', () => {
  const source = read('v2/services/page_runtime/_pipeline_state.mjs');
  assert.doesNotMatch(source, /['"]switchPage['"]/);
});
