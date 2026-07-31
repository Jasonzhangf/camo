import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProcessIdentity,
  isProcessAlive,
} from '../../../services/daemon_registration/registry.mjs';

function withProcessKill(replacement, run) {
  const original = process.kill;
  process.kill = replacement;
  try {
    return run();
  } finally {
    process.kill = original;
  }
}

test('positive: EPERM means the daemon process is alive but not signalable', () => {
  assert.equal(withProcessKill(() => {
    const error = new Error('not permitted');
    error.code = 'EPERM';
    throw error;
  }, () => isProcessAlive(42)), true);
});

test('negative: ESRCH is the only probe result classified as dead', () => {
  assert.equal(withProcessKill(() => {
    const error = new Error('missing');
    error.code = 'ESRCH';
    throw error;
  }, () => isProcessAlive(42)), false);
});

test('negative: unknown liveness probe failures enter the error chain', () => {
  assert.throws(
    () => withProcessKill(() => {
      const error = new Error('probe failed');
      error.code = 'EUNKNOWN';
      throw error;
    }, () => isProcessAlive(42)),
    (error) => error.code === 'E_IO_PROCESS'
      && error.details.op === 'daemon_registration.probe',
  );
});

test('positive: process identity binds the claim to this process generation', () => {
  const identity = getProcessIdentity(process.pid);
  assert.equal(typeof identity, 'string');
  assert.ok(identity.length > 0);
  assert.match(identity, /^(darwin|linux|win32):/);
});

test('negative: invalid process ids have no identity', () => {
  assert.equal(getProcessIdentity(0), null);
});
