import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getProcessIdentity,
  isProcessAlive,
  listRegistrations,
  listStaleRegistrations,
  findActiveDaemon,
  parseRegistration,
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

test('positive: process identity probe preserves the configured C locale', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Darwin-specific process identity environment');
    return;
  }
  const original = process.env.LANG;
  process.env.LANG = 'zh_CN.UTF-8';
  try {
    const identity = getProcessIdentity(process.pid);
    assert.match(identity, /^darwin:[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/);
  } finally {
    if (original === undefined) delete process.env.LANG;
    else process.env.LANG = original;
  }
});

function writeRegistration(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-registration-'));
  const file = path.join(dir, 'registration.json');
  fs.writeFileSync(file, JSON.stringify({
    state: 'active',
    pid: process.pid,
    processIdentity: getProcessIdentity(process.pid),
    token: 'daemon-registration-test',
    claimedAt: '2026-08-31T00:00:00.000Z',
    daemonId: 'daemon-registration-test',
    host: '127.0.0.1',
    wsPort: 49151,
    httpPort: 49152,
    scope: 'shared',
    headless: false,
    mode: 'persistent',
    startedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  }));
  return { dir, file };
}

test('positive: active daemon registration publishes the exact loopback host', (t) => {
  const registration = writeRegistration();
  t.after(() => fs.rmSync(registration.dir, { recursive: true, force: true }));

  assert.equal(parseRegistration(registration.file).host, '127.0.0.1');
});

test('negative: active daemon registration rejects an implicit endpoint host', (t) => {
  const registration = writeRegistration({ host: undefined });
  t.after(() => fs.rmSync(registration.dir, { recursive: true, force: true }));

  assert.throws(
    () => parseRegistration(registration.file),
    (error) => error.code === 'E_CONFIG_INVALID'
      && error.details.resource === 'daemon_registration',
  );
});

test('negative: active daemon registration rejects a DNS alias endpoint', (t) => {
  const registration = writeRegistration({ host: 'localhost' });
  t.after(() => fs.rmSync(registration.dir, { recursive: true, force: true }));

  assert.throws(
    () => parseRegistration(registration.file),
    (error) => error.code === 'E_CONFIG_INVALID'
      && error.details.resource === 'daemon_registration',
  );
});

test('negative: legacy active claim without host is not an active daemon for CLI reads', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-legacy-'));
  const daemonDir = path.join(dir, '.camo', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const file = path.join(daemonDir, '.shared-daemon.claim');
  fs.writeFileSync(file, JSON.stringify({
    state: 'active',
    pid: process.pid,
    processIdentity: getProcessIdentity(process.pid),
    token: 'legacy-claim',
    claimedAt: '2026-08-31T00:00:00.000Z',
    daemonId: 'daemon-legacy',
    wsPort: 49151,
    httpPort: 49152,
    scope: 'shared',
    headless: false,
    mode: 'persistent',
    startedAt: '2026-08-31T00:00:00.000Z',
  }, null, 2), 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prevPortable = process.env.CAMO_PORTABLE_ROOT;
  const prevRoot = process.env.CAMO_ROOT;
  process.env.CAMO_PORTABLE_ROOT = dir;
  process.env.CAMO_ROOT = '';
  try {
    assert.throws(
      () => parseRegistration(file),
      (error) => error.code === 'E_CONFIG_INVALID',
    );
    assert.deepEqual(listRegistrations(), [], 'legacy claim must not crash CLI reads');
    assert.equal(findActiveDaemon(), null, 'legacy claim must not be exposed as active daemon');
  } finally {
    if (prevPortable === undefined) delete process.env.CAMO_PORTABLE_ROOT;
    else process.env.CAMO_PORTABLE_ROOT = prevPortable;
    if (prevRoot === undefined) delete process.env.CAMO_ROOT;
    else process.env.CAMO_ROOT = prevRoot;
  }
});

test('positive: daemon registry honors CAMO_PORTABLE_ROOT', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-portable-'));
  const daemonDir = path.join(dir, '.camo', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const file = path.join(daemonDir, '.shared-daemon.claim');
  fs.writeFileSync(file, JSON.stringify({
    state: 'active',
    pid: process.pid,
    processIdentity: getProcessIdentity(process.pid),
    token: 'portable-claim',
    claimedAt: '2026-08-31T00:00:00.000Z',
    daemonId: 'daemon-portable',
    host: '127.0.0.1',
    wsPort: 49161,
    httpPort: 49162,
    scope: 'shared',
    headless: false,
    mode: 'persistent',
    startedAt: '2026-08-31T00:00:00.000Z',
  }, null, 2), 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prevPortable = process.env.CAMO_PORTABLE_ROOT;
  const prevRoot = process.env.CAMO_ROOT;
  process.env.CAMO_PORTABLE_ROOT = dir;
  process.env.CAMO_ROOT = '';
  try {
    const active = findActiveDaemon();
    assert.ok(active, 'portable root claim must be found');
    assert.equal(active.host, '127.0.0.1');
    assert.equal(active.wsPort, 49161);
  } finally {
    if (prevPortable === undefined) delete process.env.CAMO_PORTABLE_ROOT;
    else process.env.CAMO_PORTABLE_ROOT = prevPortable;
    if (prevRoot === undefined) delete process.env.CAMO_ROOT;
    else process.env.CAMO_ROOT = prevRoot;
  }
});

test('positive: stale registration projection excludes the live owner', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-live-'));
  const daemonDir = path.join(dir, '.camo', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const file = path.join(daemonDir, '.shared-daemon.claim');
  fs.writeFileSync(file, JSON.stringify({
    state: 'active',
    pid: process.pid,
    processIdentity: getProcessIdentity(process.pid),
    token: 'live-claim',
    claimedAt: '2026-08-31T00:00:00.000Z',
    daemonId: 'daemon-live',
    host: '127.0.0.1',
    wsPort: 49171,
    httpPort: 49172,
    scope: 'shared',
    headless: false,
    mode: 'persistent',
    startedAt: '2026-08-31T00:00:00.000Z',
  }, null, 2), 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prevPortable = process.env.CAMO_PORTABLE_ROOT;
  const prevRoot = process.env.CAMO_ROOT;
  process.env.CAMO_PORTABLE_ROOT = dir;
  process.env.CAMO_ROOT = '';
  try {
    assert.equal(listRegistrations().length, 1);
    assert.deepEqual(listStaleRegistrations(), []);
  } finally {
    if (prevPortable === undefined) delete process.env.CAMO_PORTABLE_ROOT;
    else process.env.CAMO_PORTABLE_ROOT = prevPortable;
    if (prevRoot === undefined) delete process.env.CAMO_ROOT;
    else process.env.CAMO_ROOT = prevRoot;
  }
});

test('positive: stale registration projection exposes a dead owner', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-stale-'));
  const daemonDir = path.join(dir, '.camo', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const file = path.join(daemonDir, '.shared-daemon.claim');
  fs.writeFileSync(file, JSON.stringify({
    state: 'active',
    pid: 999_999_991,
    processIdentity: 'dead:process',
    token: 'stale-claim',
    claimedAt: '2026-08-31T00:00:00.000Z',
    daemonId: 'daemon-stale',
    host: '127.0.0.1',
    wsPort: 49181,
    httpPort: 49182,
    scope: 'shared',
    headless: false,
    mode: 'persistent',
    startedAt: '2026-08-31T00:00:00.000Z',
  }, null, 2), 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prevPortable = process.env.CAMO_PORTABLE_ROOT;
  const prevRoot = process.env.CAMO_ROOT;
  process.env.CAMO_PORTABLE_ROOT = dir;
  process.env.CAMO_ROOT = '';
  try {
    assert.deepEqual(listRegistrations(), []);
    assert.equal(listStaleRegistrations()[0]?.daemonId, 'daemon-stale');
  } finally {
    if (prevPortable === undefined) delete process.env.CAMO_PORTABLE_ROOT;
    else process.env.CAMO_PORTABLE_ROOT = prevPortable;
    if (prevRoot === undefined) delete process.env.CAMO_ROOT;
    else process.env.CAMO_ROOT = prevRoot;
  }
});
