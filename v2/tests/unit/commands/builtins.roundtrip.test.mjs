import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __enableTestRoot as enableWsTestRoot,
  registerHandler,
  resetRoutes,
} from '../../../transports/ws/server.mjs';
import { sendCommand as wsSendCommand } from '../../../transports/ws/client.mjs';
import { run as runBuiltin } from '../../../commands/builtins/index.mjs';
import { parse as parseFlags } from '../../../commands/parsers/flags.mjs';

// WS-roundtrip integration: register a fake handler on the WS server,
// drive a builtin through ws client, and confirm both directions
// agree. This is the stage-4b acceptance test.

test('positive: start builtin roundtrips through WS', async () => {
  enableWsTestRoot();
  resetRoutes();
  registerHandler('command', async (env) => ({
    kind: 'result',
    payload: {
      cmd: env.payload?.cmd || null,
      sessionId: 'srv-1',
      profile: '_temp_123_456',
      ephemeral: true,
      reused: true,
      ok: true,
    },
  }));
  // The transport in production is a real ws; here we drive the
  // same wire path via wsSendCommand -> server.handleFrame -> handler.
  const transport = {
    async sendFrame(env) {
      let out;
      const { handleFrame } = await import('../../../transports/ws/server.mjs');
      // Map ws envelope -> server.handleFrame expects text; we mirror it.
      await handleFrame({
        text: JSON.stringify(env),
        send: (e) => { out = e; },
      });
      return out;
    },
  };
  const parsed = parseFlags(['--profile', 'p1', '--headless'], { cmd: 'start' });
  const out = await runBuiltin('start', transport, parsed, { traceId: 't1' });
  assert.equal(out.cmd, 'start');
  assert.equal(out.headless, true);
  assert.equal(out.profile, '_temp_123_456');
  assert.equal(out.ephemeral, true);
  assert.equal(out.reused, true);
  assert.match(out.issuedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // sanity: ISO-8601
  assert.equal(out.sessionId, 'srv-1');
});

test('positive: stop builtin projects the daemon-resolved temp profile', async () => {
  enableWsTestRoot();
  resetRoutes();
  registerHandler('command', async () => ({
    kind: 'result',
    payload: { ok: true, stopped: true, profile: '_temp_123_456', ephemeral: true },
  }));
  const transport = {
    async sendFrame(env) {
      let out;
      const { handleFrame } = await import('../../../transports/ws/server.mjs');
      await handleFrame({
        text: JSON.stringify(env),
        send: (e) => { out = e; },
      });
      return out;
    },
  };
  const parsed = parseFlags(['--profile', 'temp'], { cmd: 'stop' });
  const out = await runBuiltin('stop', transport, parsed, {});
  assert.equal(out.profile, '_temp_123_456');
  assert.equal(out.ephemeral, true);
});

test('positive: goto builtin sends the right wire args', async () => {
  enableWsTestRoot();
  resetRoutes();
  let captured;
  registerHandler('command', async (env) => {
    captured = env.payload?.args || {};
    return { kind: 'result', payload: { navigated: true } };
  });
  const transport = {
    async sendFrame(env) {
      let out;
      const { handleFrame } = await import('../../../transports/ws/server.mjs');
      await handleFrame({
        text: JSON.stringify(env),
        send: (e) => { out = e; },
      });
      return out;
    },
  };
  const parsed = parseFlags(['https://example.com/path', '--waitUntil', 'networkidle'], { cmd: 'goto' });
  const out = await runBuiltin('goto', transport, parsed, {});
  assert.equal(out.url, 'https://example.com/path');
  assert.equal(out.waitUntil, 'networkidle');
  assert.equal(captured.url, 'https://example.com/path');
  assert.equal(captured.waitUntil, 'networkidle');
  assert.equal(captured.profile, 'default');
});

test('negative: stop builtin propagates E_STATE_NOT_FOUND from server', async () => {
  enableWsTestRoot();
  resetRoutes();
  registerHandler('command', async () => ({
    kind: 'error',
    payload: { code: 'E_STATE_NOT_FOUND', message: 'no session', details: { profileId: 'gone' } },
  }));
  const transport = {
    async sendFrame(env) {
      let out;
      const { handleFrame } = await import('../../../transports/ws/server.mjs');
      await handleFrame({
        text: JSON.stringify(env),
        send: (e) => { out = e; },
      });
      return out;
    },
  };
  const parsed = parseFlags(['--profile', 'gone'], { cmd: 'stop' });
  await assert.rejects(
    () => runBuiltin('stop', transport, parsed, {}),
    (e) => e.code === 'E_STATE_NOT_FOUND'
  );
});

test('negative: click builtin enforces exactly-one of selector|text', async () => {
  enableWsTestRoot();
  resetRoutes();
  // No handler needed; the builtin throws before sending.
  const transport = { async sendFrame() { throw new Error('should not reach'); } };
  const parsedBoth = parseFlags(['--selector', '#x', '--text', 't'], { cmd: 'click' });
  await assert.rejects(
    () => runBuiltin('click', transport, parsedBoth, {}),
    (e) => e.code === 'E_INPUT_INVALID'
  );
  const parsedNone = parseFlags([], { cmd: 'click' });
  await assert.rejects(
    () => runBuiltin('click', transport, parsedNone, {}),
    (e) => e.code === 'E_INPUT_INVALID'
  );
});

test('negative: type builtin rejects empty text', async () => {
  enableWsTestRoot();
  resetRoutes();
  const transport = { async sendFrame() { throw new Error('should not reach'); } };
  const parsed = parseFlags([''], { cmd: 'type' });
  // empty positional '' - parser treats empty string as missing; we
  // simulate a successful parse with empty text by stashing in positional
  parsed.positional = [''];
  await assert.rejects(
    () => runBuiltin('type', transport, parsed, {}),
    (e) => e.code === 'E_INPUT_MISSING_FIELD'
  );
});

test('utility: builtin dispatcher rejects unknown cmd', async () => {
  await assert.rejects(
    () => runBuiltin('not-a-cmd', {}, {}, {}),
    (e) => e.code === 'E_PROTO_NO_HANDLER'
  );
});
