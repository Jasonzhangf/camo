// camo v2 E2E integration: session lifecycle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as runBuiltin } from '../../commands/builtins/index.mjs';
import { parse as parseFlags } from '../../commands/parsers/flags.mjs';

function createMockTransport() {
  return {
    async sendFrame(envelope) {
      return {
        v: 'camo.v2.protocol/v1',
        id: envelope.id,
        kind: 'result',
        ts: new Date().toISOString(),
        payload: { cmd: envelope.payload?.cmd, ok: true, ...envelope.payload?.args },
      };
    },
  };
}

test('E2E: start session creates session', async () => {
  const transport = createMockTransport();
  const parsed = parseFlags(['--profile', 'test-profile'], { cmd: 'start' });
  const result = await runBuiltin('start', transport, parsed, { traceId: 'e2e-1' });
  assert.equal(result.cmd, 'start');
  assert.equal(result.profile, 'test-profile');
  assert.ok(result.issuedAt);
});

test('E2E: goto navigates to URL', async () => {
  const transport = createMockTransport();
  const parsed = parseFlags(['https://example.com', '--profile', 'test-profile'], { cmd: 'goto' });
  const result = await runBuiltin('goto', transport, parsed, { traceId: 'e2e-2' });
  assert.equal(result.cmd, 'goto');
  assert.equal(result.url, 'https://example.com');
});

test('E2E: stop session terminates', async () => {
  const transport = createMockTransport();
  const parsed = parseFlags(['--profile', 'test-profile'], { cmd: 'stop' });
  const result = await runBuiltin('stop', transport, parsed, { traceId: 'e2e-3' });
  assert.equal(result.cmd, 'stop');
  assert.equal(result.profile, 'test-profile');
});
