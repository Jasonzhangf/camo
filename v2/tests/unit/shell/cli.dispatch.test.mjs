import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch, usage, describe, makeFakeTransport } from '../../../shell/cli/dispatch.mjs';

test('positive: --help returns help kind (no transport needed)', async () => {
  const out = await dispatch(['--help']);
  assert.equal(out.kind, 'help');
  assert.match(out.usage, /Usage: camo/);
});

test('positive: usage lists all 12 commands', () => {
  const u = usage();
  for (const c of ['start', 'stop', 'goto', 'click', 'type', 'snapshot', 'scroll', 'screenshot', 'wait', 'evaluate', 'upload', 'select', 'search']) {
    assert.match(u, new RegExp(`\\b${c}\\b`));
  }
});

test('positive: goto <url> runs end-to-end via fake transport', async () => {
  const fake = makeFakeTransport();
  const out = await dispatch(['goto', 'https://example.com', '--waitUntil', 'networkidle'], { transport: fake });
  assert.equal(out.kind, 'result');
  assert.equal(out.cmd, 'goto');
  assert.equal(out.result.profile, 'default');
  assert.equal(out.result.url, 'https://example.com');
  assert.equal(out.result.waitUntil, 'networkidle');
});

test('negative: goto without url surfaces E_INPUT_MISSING_FIELD', async () => {
  const fake = makeFakeTransport();
  try {
    await dispatch(['goto'], { transport: fake });
    assert.fail('expected error');
  } catch (err) {
    assert.equal(err.code, 'E_INPUT_MISSING_FIELD');
  }
});

test('negative: click without selector|text surfaces E_INPUT_INVALID', async () => {
  const fake = makeFakeTransport();
  try {
    await dispatch(['click'], { transport: fake });
    assert.fail('expected error');
  } catch (err) {
    assert.equal(err.code, 'E_INPUT_INVALID');
  }
});

test('positive: doctor subcommand runs read-only check (no transport needed)', async () => {
  const out = await dispatch(['doctor']);
  assert.equal(out.kind, 'doctor');
  assert.ok(out.report);
});

test('positive: describe reports L5_shell', () => {
  const d = describe();
  assert.equal(d.moduleId, 'shell.cli');
  assert.equal(d.layer, 'L5_shell');
});

test('negative: dispatch without transport surfaces E_STATE_NO_TRANSPORT', async () => {
  try {
    await dispatch(['goto', 'https://example.com']);
    assert.fail('expected error');
  } catch (err) {
    assert.equal(err.code, 'E_STATE_NO_TRANSPORT');
  }
});
