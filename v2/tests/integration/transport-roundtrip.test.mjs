// camo v2 E2E integration: transport roundtrip
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build as buildEnvelope, parse as parseEnvelope } from '../../contracts/ws_messages/v1/envelope.mjs';
import { project as projectError } from '../../contracts/error_envelope/projector.mjs';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

test('E2E: envelope roundtrip - result message', () => {
  const original = buildEnvelope({
    kind: 'command',
    id: 'msg-1',
    payload: { cmd: 'goto', navigated: true, url: 'https://example.com' },
  });
  // parse expects JSON string
  const serialized = JSON.stringify(original);
  const parsed = parseEnvelope(serialized);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.id, 'msg-1');
  assert.equal(parsed.payload.cmd, 'goto');
});

test('E2E: envelope roundtrip - command message', () => {
  const original = buildEnvelope({
    kind: 'command',
    id: 'msg-2',
    payload: { cmd: 'click', args: { profile: 'p1', selector: '#btn' } },
  });
  const parsed = parseEnvelope(JSON.stringify(original));
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.id, 'msg-2');
  assert.equal(parsed.payload.args.selector, '#btn');
});

test('E2E: error envelope roundtrip', () => {
  const original = buildEnvelope({
    kind: 'error',
    id: 'msg-3',
    payload: { code: 'E_STATE_NOT_FOUND', message: 'Session not found' },
  });
  const parsed = parseEnvelope(JSON.stringify(original));
  assert.equal(parsed.kind, 'error');
  assert.equal(parsed.payload.code, 'E_STATE_NOT_FOUND');
});

test('E2E: error projector produces correct envelope', () => {
  const err = new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url' } });
  const envelope = buildEnvelope({
    kind: 'error',
    id: 'msg-4',
    payload: projectError(err),
  });
  assert.equal(envelope.kind, 'error');
  assert.equal(envelope.payload.code, 'E_INPUT_INVALID');
});

test('E2E: multiple sequential messages maintain order', () => {
  for (let i = 0; i < 5; i++) {
    const original = buildEnvelope({
      kind: 'command',
      id: `msg-${i}`,
      payload: { cmd: 'goto', args: { profile: 'p1', url: `https://example.com/${i}` } },
    });
    const parsed = parseEnvelope(JSON.stringify(original));
    assert.equal(parsed.id, `msg-${i}`);
    assert.equal(parsed.payload.args.url, `https://example.com/${i}`);
  }
});
