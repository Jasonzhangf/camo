import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lock from '../../../services/lock/manager.mjs';

lock.__enableTestRoot();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-lock-'));
lock.__setLocksRootForTest(tmpRoot);

// process.pid is guaranteed live; we use it as the "live holder".
const livePid = process.pid;

test('positive: acquire on free profile writes lock file', () => {
  const r = lock.acquire('p1', { owner: 'browser-service', pid: 99001 });
  assert.equal(r.profileId, 'p1');
  assert.equal(r.owner, 'browser-service');
  assert.equal(r.mode, 'F');
  assert.ok(fs.existsSync(path.join(tmpRoot, 'p1', 'lock.json')));
});

test('positive: same owner re-acquire is a no-op', () => {
  const a = lock.acquire('p2', { owner: 'browser-service', pid: process.pid });
  const b = lock.acquire('p2', { owner: 'browser-service', pid: process.pid });
  assert.deepEqual(b, a);
});

test('positive: release by holder removes file', () => {
  lock.acquire('p3', { owner: 'browser-service', pid: 99003 });
  const ok = lock.release('p3', { owner: 'browser-service', pid: 99003 });
  assert.equal(ok, true);
  assert.equal(fs.existsSync(path.join(tmpRoot, 'p3', 'lock.json')), false);
});

test('positive: probe returns stale=true for dead pid and held=false', () => {
  lock.acquire('p4', { owner: 'browser-service', pid: 999999999 });
  const p = lock.probe('p4');
  assert.equal(p.held, false);
  assert.equal(p.stale, true);
});

test('positive: cleanupStale removes only stale files', () => {
  lock.acquire('p5-stale', { owner: 'browser-service', pid: 999999998 });   // stale
  lock.acquire('p6-live',  { owner: 'browser-service', pid: livePid });      // live
  const removed = lock.cleanupStale();
  assert.ok(removed.includes('p5-stale'));
  assert.equal(removed.includes('p6-live'), false);
});

test('positive: listHeld returns live holders only', () => {
  const held = lock.listHeld();
  assert.ok(held.includes('p6-live'));
  assert.equal(held.includes('p5-stale'), false);
});
