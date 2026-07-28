import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __enableTestRoot, sendCommand } from '../../../transports/ws/client.mjs';
import { build as buildEnvelope } from '../../../contracts/ws_messages/v1/envelope.mjs';

test('positive: sendCommand returns payload on matching id', async () => {
  __enableTestRoot();
  const transport = {
    async sendFrame(env) {
      // Echo as success
      return buildEnvelope({ id: env.id, kind: 'result', payload: { ack: true, kind: env.kind, cmd: env.payload?.cmd || null } });
    },
  };
  const out = await sendCommand(transport, { kind: 'command', payload: { cmd: 'start', args: {} } });
  assert.equal(out.kind, 'result');
  assert.equal(out.payload.ack, true);
  assert.equal(out.payload.cmd, 'start');
});

test('negative: sendCommand throws E_PROTO_BAD_ENVELOPE on id mismatch', async () => {
  __enableTestRoot();
  const transport = {
    async sendFrame(_env) {
      return buildEnvelope({ id: 'wrong', kind: 'result', payload: {} });
    },
  };
  await assert.rejects(
    () => sendCommand(transport, { kind: 'command', payload: { cmd: 'start' } }),
    (e) => e.code === 'E_PROTO_BAD_ENVELOPE'
  );
});

test('negative: sendCommand propagates error envelope as CamoError', async () => {
  __enableTestRoot();
  const transport = {
    async sendFrame(env) {
      return buildEnvelope({ id: env.id, kind: 'error', payload: { code: 'E_INPUT_INVALID', message: 'bad', details: {} } });
    },
  };
  await assert.rejects(
    () => sendCommand(transport, { kind: 'command', payload: { cmd: 'start' } }),
    (e) => e.code === 'E_INPUT_INVALID'
  );
});

test('negative: sendCommand rejects missing transport', async () => {
  __enableTestRoot();
  await assert.rejects(
    () => sendCommand(null, { kind: 'command', payload: { cmd: 'start' } }),
    (e) => e.code === 'E_INPUT_INVALID'
  );
});
