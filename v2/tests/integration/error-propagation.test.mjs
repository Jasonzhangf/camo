// camo v2 E2E integration: error propagation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as runBuiltin } from '../../commands/builtins/index.mjs';
import { parse as parseFlags } from '../../commands/parsers/flags.mjs';

function createErrorTransport(code) {
  return {
    async sendFrame(envelope) {
      return {
        v: 'camo.v2.protocol/v1',
        id: envelope.id,
        kind: 'error',
        ts: new Date().toISOString(),
        payload: { code, message: 'Test error', details: {} },
      };
    },
  };
}

test('E2E: E_STATE_NOT_FOUND propagates from server', async () => {
  const transport = createErrorTransport('E_STATE_NOT_FOUND');
  await assert.rejects(
    () => runBuiltin('stop', transport, parseFlags(['--profile', 'gone'], { cmd: 'stop' }), {}),
    (e) => e.code === 'E_STATE_NOT_FOUND'
  );
});

test('E2E: E_INPUT_INVALID thrown locally', async () => {
  const transport = createErrorTransport('E_STATE_NOT_FOUND');
  await assert.rejects(
    () => runBuiltin('scroll', transport, parseFlags(['--x', '0', '--y', '0'], { cmd: 'scroll' }), {}),
    (e) => e.code === 'E_INPUT_INVALID'
  );
});

test('E2E: E_INPUT_MISSING_FIELD thrown locally', async () => {
  const transport = createErrorTransport('E_STATE_NOT_FOUND');
  await assert.rejects(
    () => runBuiltin('evaluate', transport, parseFlags([], { cmd: 'evaluate' }), {}),
    (e) => e.code === 'E_INPUT_MISSING_FIELD'
  );
});

test('E2E: error with details preserved', async () => {
  const transport = createErrorTransport('E_PROTO_NO_HANDLER');
  await assert.rejects(
    () => runBuiltin('stop', transport, parseFlags([], { cmd: 'stop' }), {}),
    (e) => e.code === 'E_PROTO_NO_HANDLER'
  );
});
