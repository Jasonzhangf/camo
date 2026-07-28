import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, WS_KINDS, HTTP_KINDS, COMMAND_IDS, isCommandId } from '../../../../protocol/versions/v1.mjs';

test('positive: VERSION string is the v1 contract id', () => {
  assert.equal(VERSION, 'camo.v2.protocol/v1');
});

test('positive: WS_KINDS and HTTP_KINDS are frozen', () => {
  assert.equal(Object.isFrozen(WS_KINDS), true);
  assert.equal(Object.isFrozen(HTTP_KINDS), true);
  assert.equal(WS_KINDS.COMMAND, 'command');
  assert.equal(HTTP_KINDS.HEALTH, 'health');
});

test('positive: isCommandId recognises well-known ids', () => {
  for (const id of ['start', 'stop', 'goto', 'click', 'type', 'snapshot']) {
    assert.equal(isCommandId(id), true, id);
  }
});

test('negative: isCommandId rejects unknown ids', () => {
  assert.equal(isCommandId('unknown_cmd'), false);
  assert.equal(isCommandId(''), false);
  assert.equal(isCommandId(null), false);
});

test('negative: WS_KINDS is immutable', () => {
  const before = WS_KINDS.COMMAND;
  try { WS_KINDS.COMMAND = 'other'; } catch {}
  assert.equal(WS_KINDS.COMMAND, before);
});
