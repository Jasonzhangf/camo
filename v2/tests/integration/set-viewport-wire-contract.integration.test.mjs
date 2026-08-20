import test from 'node:test';
import assert from 'node:assert/strict';

import { run as runSetViewport } from '../../commands/builtins/setViewport.mjs';
import { handleCommand } from '../../shell/daemon/command_handlers.mjs';
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
    opts: { mode: 'persistent', daemonId: 'viewport-wire-test' },
    ensureBrowser: async () => {},
  };
}

test('set-viewport projects runtime success through the daemon wire contract', async () => {
  enablePipeline();
  enableBridge();
  const calls = [];
  const profile = 'viewport_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      setViewportSize: async (viewport) => calls.push(viewport),
    },
  });

  const transport = wireTransport((args) => handleCommand('set-viewport', args, daemonContext(profile)));
  const output = await runSetViewport(transport, {
    profile,
    named: { width: '390', height: '844' },
  });

  assert.deepEqual(calls, [{ width: 390, height: 844 }]);
  assert.equal(output.set, true);
});

test('set-viewport rejects a success-shaped response without set truth', async () => {
  const malformedTransport = wireTransport(async () => ({ ok: true, viewportSet: true }));
  await assert.rejects(
    () => runSetViewport(malformedTransport, {
      profile: 'viewport_wire_contract',
      named: { width: '390', height: '844' },
    }),
    (cause) => cause?.code === 'E_PROTO_BAD_ENVELOPE',
  );
});
