import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const callerUrls = [
  new URL('../../../commands/builtins/daemon.mjs', import.meta.url),
  new URL('../../../shell/bin_entry/index.mjs', import.meta.url),
];

test('positive: both CLI daemon starters delegate to the shared process owner', () => {
  for (const callerUrl of callerUrls) {
    const source = fs.readFileSync(callerUrl, 'utf8');
    assert.match(source, /spawnDaemonProcess/);
    assert.doesNotMatch(source, /from ['"]node:child_process['"]/);
    assert.doesNotMatch(source, /\bspawn\s*\(/);
  }
});

test('positive: detached daemon stdio cannot retain parent-owned pipes', async () => {
  const { spawnDaemonProcess } = await import('../../../services/daemon_process/spawn.mjs');
  const calls = [];
  let unrefCount = 0;
  const fakeChild = {
    unref() { unrefCount += 1; },
  };

  const child = spawnDaemonProcess({
    scriptPath: '/tmp/camo-daemon-entry.mjs',
    args: ['--profile', 'test-profile'],
    env: { KEEP_ME: 'yes', CAMO_WS_PORT: '7777', CAMO_HTTP_PORT: '8888' },
    spawnImpl(executable, args, options) {
      calls.push({ executable, args, options });
      return fakeChild;
    },
  });

  assert.equal(child, fakeChild);
  assert.equal(unrefCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, process.execPath);
  assert.deepEqual(calls[0].args, [
    '/tmp/camo-daemon-entry.mjs',
    '--profile',
    'test-profile',
  ]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[0].options.env.KEEP_ME, 'yes');
  assert.equal(calls[0].options.env.CAMO_WS_PORT, '0');
  assert.equal(calls[0].options.env.CAMO_HTTP_PORT, '0');
});
