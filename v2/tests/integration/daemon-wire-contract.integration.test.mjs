import test from 'node:test';
import assert from 'node:assert/strict';

import { run as runScroll } from '../../commands/builtins/scroll.mjs';
import { run as runType } from '../../commands/builtins/type.mjs';
import { handleCommand } from '../../shell/daemon/command_handlers.mjs';
import { isBrowserCommand } from '../../shell/daemon/browser_commands.mjs';
import { __enableTestRoot as enablePipeline } from '../../services/page_runtime/input_pipeline.mjs';
import {
  __enableTestRoot as enableBridge,
  __setBrowserForTest,
} from '../../services/browser_service/internal/camoufox_bridge.mjs';

function wireTransport(handler) {
  return {
    async sendFrame(env) {
      return { ...env, kind: 'result', payload: await handler(env.payload.args) };
    },
  };
}

function daemonContext(profile) {
  return {
    profile,
    opts: { mode: 'persistent', daemonId: 'wire-test' },
    ensureBrowser: async () => {},
  };
}

test('scroll preserves CLI dx/dy through daemon to protocol wheel', async () => {
  enablePipeline();
  enableBridge();
  const wheelCalls = [];
  const profile = 'scroll_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      mouse: {
        move: async () => {},
        wheel: async (x, y) => wheelCalls.push([x, y]),
      },
    },
  });
  const transport = wireTransport((args) => handleCommand('scroll', args, daemonContext(profile)));
  await runScroll(transport, { profile, named: { x: 17, y: 91 } });
  assert.deepEqual(wheelCalls, [[17, 91]]);
});

test('type projects typedChars from runtime and rejects missing response truth', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'type_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      keyboard: { press: async () => {}, type: async () => {} },
    },
  });
  const transport = wireTransport((args) => handleCommand('type', args, daemonContext(profile)));
  const output = await runType(transport, { profile, positional: ['Jason'], named: {} });
  assert.equal(output.typedChars, 5);

  const malformedTransport = wireTransport(async () => ({ ok: true, typed: true }));
  await assert.rejects(
    () => runType(malformedTransport, { profile, positional: ['Jason'], named: {} }),
    (cause) => cause?.code === 'E_PROTO_BAD_ENVELOPE',
  );
});

test('hover belongs to the canonical ephemeral browser command set', () => {
  assert.equal(isBrowserCommand('hover'), true);
  assert.equal(isBrowserCommand('get-page-info'), false);
});
