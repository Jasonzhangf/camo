import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lock from '../../../services/lock/manager.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

lock.__enableTestRoot();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-lock-fail-'));
lock.__setLocksRootForTest(tmpRoot);

test('negative: friendly acquire on live-held profile throws E_STATE_LOCKED', () => {
  lock.acquire('q1', { owner: 'browser-service', pid: process.pid });  // live holder
  let err;
  try { lock.acquire('q1', { owner: 'browser-service', pid: 99202, mode: 'F' }); } catch (e) { err = e; }
  assert.equal(err instanceof CamoError, true);
  assert.equal(err.code, 'E_STATE_LOCKED');
  assert.equal(err.details.holder.pid, process.pid);
});

test('negative: friendly acquire on stale pid succeeds and takes over', () => {
  lock.acquire('q2', { owner: 'browser-service', pid: 999999997 });
  const taken = lock.acquire('q2', { owner: 'browser-service', pid: 99303, mode: 'F' });
  assert.equal(taken.pid, 99303);
});

test('negative: release by non-holder throws E_STATE_LOCKED', () => {
  lock.acquire('q3', { owner: 'browser-service', pid: 99404 });
  let err;
  try { lock.release('q3', { owner: 'browser-service', pid: 99505 }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_STATE_LOCKED');
});

test('negative: read missing throws E_STATE_NOT_FOUND', () => {
  let err;
  try { lock.read('not-locked'); } catch (e) { err = e; }
  assert.equal(err.code, 'E_STATE_NOT_FOUND');
});

test('negative: empty profileId throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { lock.acquire('', { pid: 1 }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: invalid mode throws E_INPUT_OUT_OF_RANGE', () => {
  let err;
  try { lock.acquire('p', { pid: 1, mode: 'F!!' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_OUT_OF_RANGE');
});

test('negative: force_acquire on stale pid succeeds (real SIGKILL skipped because pid is dead)', () => {
  lock.acquire('q4', { owner: 'browser-service', pid: 999999996 });
  const taken = lock.forceAcquire('q4', { owner: 'browser-service', pid: 99606 });
  assert.equal(taken.pid, 99606);
});
