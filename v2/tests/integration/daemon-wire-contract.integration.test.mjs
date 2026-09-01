import test from 'node:test';
import assert from 'node:assert/strict';

import { run as runScroll } from '../../commands/builtins/scroll.mjs';
import { run as runType } from '../../commands/builtins/type.mjs';
import { run as runClick } from '../../commands/builtins/click.mjs';
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

test('negative: click timeout crosses the daemon wire and releases the profile lock', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'click_timeout_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      viewportSize: () => ({ width: 800, height: 600 }),
      evaluate: async () => ({ title: 'still alive', url: 'https://example.com/' }),
      locator: () => ({
        count: async () => 1,
        nth() { return this; },
        first() { return this; },
        async boundingBox() { return { x: 200, y: 900, width: 80, height: 20 }; },
      }),
      mouse: {
        move: async () => {},
        wheel: async () => new Promise(() => {}),
        down: async () => {},
        up: async () => {},
      },
    },
  });
  const transport = wireTransport((args) => handleCommand('click', args, daemonContext(profile)));

  await assert.rejects(
    () => runClick(transport, { profile, named: { selector: '#target', timeout: 20 } }),
    (cause) => cause?.code === 'E_IO_TIMEOUT',
  );
  const info = await handleCommand('get-page-info', { profile }, daemonContext(profile));
  assert.equal(info.ok, true);
});
test('hover belongs to the canonical ephemeral browser command set', () => {
  assert.equal(isBrowserCommand('hover'), true);
  assert.equal(isBrowserCommand('get-page-info'), false);
});
