import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../commands/builtins/status.mjs';
import { parse } from '../../../commands/parsers/flags.mjs';

test('positive: status builtin forwards profile and target filters', async () => {
  let captured;
  const transport = {
    async sendFrame(envelope) {
      captured = envelope.payload.args;
      return {
        id: envelope.id,
        kind: 'result',
        payload: {
          ok: true,
          service: { state: 'available' },
          profiles: [],
          targets: [],
          execution: [],
          reclamation: { pending: [] },
          errors: [],
        },
      };
    },
  };
  const parsed = parse(['--profile', 'default', '--target', 't_abc'], { cmd: 'status' });
  const out = await run(transport, parsed, {});

  assert.deepEqual(captured, { profile: 'default', target: 't_abc' });
  assert.equal(out.service.state, 'available');
  assert.equal(out.cmd, 'status');
});

test('negative: status builtin rejects an invalid target id before transport', async () => {
  const parsed = parse(['--target', 'bad target'], { cmd: 'status' });
  await assert.rejects(
    () => run({ sendFrame: async () => { throw new Error('unreachable'); } }, parsed, {}),
    (error) => error.code === 'E_INPUT_INVALID',
  );
});
