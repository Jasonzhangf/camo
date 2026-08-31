import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../commands/parsers/flags.mjs';
import { run } from '../../../commands/builtins/wait.mjs';
import { __enableTestRoot as enableWsTestRoot, registerHandler, resetRoutes } from '../../../transports/ws/server.mjs';

test('positive: wait --ms is parsed as a non-negative integer and projected unchanged', async () => {
  const parsed = parse(['--ms', '250', '--profile', 'wait-contract'], { cmd: 'wait' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.named.ms, 250);

  enableWsTestRoot();
  resetRoutes();
  let frame = null;
  registerHandler('command', async (env) => {
    frame = env;
    return { kind: 'result', payload: { satisfied: true } };
  });
  const transport = {
    async sendFrame(env) {
      let out;
      const { handleFrame } = await import('../../../transports/ws/server.mjs');
      await handleFrame({ text: JSON.stringify(env), send: (value) => { out = value; } });
      return out;
    },
  };
  const reply = await run(transport, parsed);
  assert.equal(reply.satisfied, true);
  assert.equal(frame.payload.args.ms, 250);
});

test('negative: wait --ms rejects negative and non-integer values', () => {
  const negative = parse(['--ms', '-1'], { cmd: 'wait' });
  assert.equal(negative.errors.some((error) => error.field === 'ms'), true);

  const fractional = parse(['--ms', '1.5'], { cmd: 'wait' });
  assert.equal(fractional.errors.some((error) => error.field === 'ms'), true);
});
