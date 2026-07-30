// camo v2 E2E integration: command execution
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as runBuiltin } from '../../commands/builtins/index.mjs';
import { parse as parseFlags } from '../../commands/parsers/flags.mjs';

function createMockTransport() {
  let idCounter = 0;
  return {
    async sendFrame(envelope) {
      const replyId = envelope.id || `mock-${++idCounter}`;
      // Return a valid reply envelope
      return {
        v: 'camo.v2.protocol/v1',
        id: replyId,
        kind: 'result',
        ts: new Date().toISOString(),
        payload: { cmd: envelope.payload?.cmd, ok: true, ...envelope.payload?.args },
      };
    },
  };
}

const COMMANDS = [
  { cmd: 'goto', args: ['https://example.com'], check: (r) => r.url === 'https://example.com' },
  { cmd: 'click', args: ['--selector', '#btn'], check: (r) => r.selector === '#btn' },
  { cmd: 'type', args: ['hello world'], check: (r) => r.text === 'hello world' },
  { cmd: 'scroll', args: ['--x', '100', '--y', '200'], check: (r) => r.dx === 100 && r.dy === 200 },
  { cmd: 'screenshot', args: ['--path', '/tmp/test.png'], check: (r) => r.path === '/tmp/test.png' },
  { cmd: 'wait', args: ['--for', 'load'], check: (r) => r.for === 'load' },
  { cmd: 'evaluate', args: ['--script', 'document.title'], check: (r) => r.cmd === 'evaluate' && r.profile === 'default' },
  { cmd: 'upload', args: ['--selector', 'input[type=file]', '--file', '/tmp/test.txt'], check: (r) => r.selector === 'input[type=file]' },
  { cmd: 'select', args: ['--selector', 'select', '--value', 'opt1'], check: (r) => r.value === 'opt1' },
  { cmd: 'snapshot', args: [], check: (r) => r.format === 'json' },
];

for (const tc of COMMANDS) {
  test(`E2E: ${tc.cmd} executes correctly`, async () => {
    const transport = createMockTransport();
    const parsed = parseFlags(tc.args, { cmd: tc.cmd });
    const result = await runBuiltin(tc.cmd, transport, parsed, { traceId: `e2e-${tc.cmd}` });
    assert.equal(result.cmd, tc.cmd);
    assert.ok(tc.check(result), `${tc.cmd} check failed`);
  });
}

test('E2E: all commands return timestamp', async () => {
    const transport = createMockTransport();
    for (const cmd of ['start', 'goto']) {
      const parsed = parseFlags(cmd === 'goto' ? ['https://test.com'] : [], { cmd });
      const result = await runBuiltin(cmd, transport, parsed, { traceId: 'e2e-ts' });
      assert.ok(result.issuedAt || result.releasedAt, cmd + ' missing timestamp');
    }
  });
