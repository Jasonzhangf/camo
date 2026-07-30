import { test } from 'node:test';
import assert from 'node:assert/strict';

import { list, has, look, describe } from '../../../commands/registry/registry.mjs';

// Registry stores commands in kebab-case (CLI interface)
const EXPECTED_CMDS = [
  'click', 'close-tab', 'daemon', 'evaluate', 'fetch-page', 'find-elements',
  'get-cookies', 'get-page-info', 'get-readable', 'get-text', 'goto', 'hover',
  'list-tabs', 'new-tab', 'screenshot', 'scroll', 'scroll-and-collect', 'select',
  'set-cookies', 'set-user-agent', 'set-viewport', 'snapshot', 'start', 'stop',
  'type', 'upload', 'wait', 'wait-dom-stable',
];

test('positive: list returns all 28 commands sorted', () => {
  const a = list();
  assert.equal(a.length, 28);
  assert.deepEqual(a, EXPECTED_CMDS);
});

test('positive: has returns true for known cmd + false for unknown', () => {
  assert.equal(has('start'), true);
  assert.equal(has('scroll'), true);
  assert.equal(has('not-a-cmd'), false);
  assert.equal(has(''), false);
});

test('negative: look throws for unknown cmd', () => {
  assert.throws(() => look('nonexistent'), /No handler/);
  assert.throws(() => look(''), /No handler/);
});

test('positive: describe includes count', () => {
  const d = describe();
  assert.equal(d.count, 28);
  assert.equal(d.layer, 'L4_command');
  assert.equal(d.moduleId, 'commands.registry');
});

test('positive: every list() entry has valid spec', () => {
  for (const cmd of list()) {
    const spec = look(cmd);
    assert.equal(spec.cmd, cmd);
    assert.ok(spec.module, `${cmd} missing module`);
    assert.ok(spec.args_schema, `${cmd} missing args_schema`);
  }
});
