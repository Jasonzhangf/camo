import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __enableTestRoot, dispatch, usage, describe } from '../../../shell/cli/dispatch.mjs';
import { __enableTestRoot as enableServer } from '../../../transports/ws/server.mjs';

test('positive: --help returns help kind', async () => {
  __enableTestRoot();
  const out = await dispatch(['--help']);
  assert.equal(out.kind, 'help');
  assert.match(out.usage, /Usage: camo/);
});

test('positive: usage lists all 6 commands', () => {
  const u = usage();
  for (const c of ['start', 'stop', 'goto', 'click', 'type', 'snapshot']) {
    assert.match(u, new RegExp(`\\b${c}\\b`));
  }
});

test('positive: goto <url> runs end-to-end via fake transport', async () => {
  __enableTestRoot();
  enableServer();
  const out = await dispatch(['goto', 'https://example.com', '--waitUntil', 'networkidle']);
  assert.equal(out.kind, 'result');
  assert.equal(out.cmd, 'goto');
  assert.equal(out.result.profile, 'default');
  assert.equal(out.result.url, 'https://example.com');
  assert.equal(out.result.waitUntil, 'networkidle');
});

test('negative: goto without url surfaces E_INPUT_MISSING_FIELD', async () => {
  __enableTestRoot();
  await assert.rejects(
    () => dispatch(['goto']),
    (e) => e.code === 'E_INPUT_MISSING_FIELD'
  );
});

test('negative: click without selector|text surfaces E_INPUT_INVALID', async () => {
  __enableTestRoot();
  await assert.rejects(
    () => dispatch(['click']),
    (e) => e.code === 'E_INPUT_INVALID'
  );
});

test('utility: doctor subcommand runs read-only check', async () => {
  __enableTestRoot();
  const out = await dispatch(['doctor']);
  assert.equal(out.kind, 'doctor');
  assert.ok(out.report.protocol);
  assert.ok(out.report.registry.commands >= 6);
});

test('utility: describe reports L5_shell', () => {
  const d = describe();
  assert.equal(d.layer, 'L5_shell');
  assert.equal(d.moduleId, 'shell.cli');
});
