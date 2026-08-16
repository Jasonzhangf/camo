// Profile lock iteration safety. cleanupStale / listHeld must skip any
// directory under the profiles root whose name does not match PROFILE_ID_PATTERN.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lock from '../../../services/lock/manager.mjs';

lock.__enableTestRoot();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-lock-iter-'));
lock.__setLocksRootForTest(root);

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function ensureDir(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('positive: cleanupStale skips illegal profile directory names without throwing', () => {
  ensureDir('..weird name..');
  ensureDir('contains/slash');
  ensureDir('valid-id');

  lock.acquire('valid-id', { owner: 'browser-service', pid: 999999997 });

  const removed = lock.cleanupStale();
  assert.deepEqual(removed, ['valid-id']);
});

test('positive: listHeld skips illegal profile directory names without throwing', () => {
  ensureDir('another*bad');
  ensureDir('clean-id');

  lock.acquire('clean-id', { owner: 'browser-service', pid: process.pid });

  const held = lock.listHeld();
  assert.deepEqual(held, ['clean-id']);
});
