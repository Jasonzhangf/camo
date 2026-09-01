import test from 'node:test';
import assert from 'node:assert/strict';

import { run as runBack } from '../../commands/builtins/back.mjs';
import { run as runForward } from '../../commands/builtins/forward.mjs';
import { run as runReload } from '../../commands/builtins/reload.mjs';
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

test('tab command projections preserve count and closed truth', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'tabs_wire_contract';
  const closedPages = [];
  const pages = [
    { url: () => 'https://example.com/', title: async () => 'Example', close: async () => closedPages.push('https://example.com/') },
    { url: () => 'about:newtab', title: async () => '' },
    { url: () => 'https://news.ycombinator.com/', title: async () => 'Hacker News', close: async () => closedPages.push('https://news.ycombinator.com/') },
  ];
  __setBrowserForTest(profile, {
    context: {
      pages: () => pages,
    },
  });

  const listed = await handleCommand('list-tabs', { profile }, daemonContext(profile));
  assert.equal(listed.ok, true);
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.tabs.map((tab) => tab.url), [
    'https://example.com/',
    'https://news.ycombinator.com/',
  ]);

  const closed = await handleCommand('close-tab', { profile, tabId: 1 }, daemonContext(profile));
  assert.equal(closed.ok, true);
  assert.equal(closed.closed, true);
  assert.deepEqual(closedPages, ['https://news.ycombinator.com/']);
});

test('switch-tab resolves the same visible tab ids as list-tabs', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'switch_tabs_wire_contract';
  const fronted = [];
  const pages = [
    {
      url: () => 'https://example.com/',
      title: async () => 'Example',
      bringToFront: async () => fronted.push('https://example.com/'),
    },
    { url: () => 'about:newtab', title: async () => '' },
    {
      url: () => 'https://news.ycombinator.com/',
      title: async () => 'Hacker News',
      bringToFront: async () => fronted.push('https://news.ycombinator.com/'),
    },
  ];
  __setBrowserForTest(profile, {
    context: { pages: () => pages },
  });

  const switched = await handleCommand('switch-tab', { profile, tabId: 1 }, daemonContext(profile));
  assert.equal(switched.ok, true);
  assert.equal(switched.switched, true);
  assert.equal(switched.tabId, 1);
  assert.equal(switched.url, 'https://news.ycombinator.com/');
  assert.deepEqual(fronted, ['https://news.ycombinator.com/']);
});

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

test('snapshot projects the full HTML payload through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'snapshot_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      url: () => 'https://example.com/',
      content: async () => '<html><body>Example</body></html>',
    },
  });
  const result = await handleCommand('snapshot', { profile }, daemonContext(profile));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot, true);
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.htmlLength, 33);
  assert.equal(result.html, '<html><body>Example</body></html>');
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

test('back projects navigated/finalUrl through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'back_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      url: () => 'https://example.com/',
      goBack: async () => ({ status: () => 200, ok: () => true }),
    },
  });
  const transport = wireTransport((args) => handleCommand('back', args, daemonContext(profile)));
  const output = await runBack(transport, { profile, named: {} });
  assert.equal(output.cmd, 'back');
  assert.equal(output.profile, profile);
  assert.equal(output.navigated, true);
  assert.equal(output.finalUrl, 'https://example.com/');
});

test('back reports navigated=false when there is no previous history entry', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'back_empty_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      url: () => 'https://example.com/',
      goBack: async () => null,
    },
  });
  const transport = wireTransport((args) => handleCommand('back', args, daemonContext(profile)));
  const output = await runBack(transport, { profile, named: {} });
  assert.equal(output.navigated, false);
});

test('forward projects navigated/finalUrl through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'forward_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      url: () => 'https://example.com/',
      goForward: async () => ({ status: () => 200, ok: () => true }),
    },
  });
  const transport = wireTransport((args) => handleCommand('forward', args, daemonContext(profile)));
  const output = await runForward(transport, { profile, named: {} });
  assert.equal(output.cmd, 'forward');
  assert.equal(output.navigated, true);
  assert.equal(output.finalUrl, 'https://example.com/');
});

test('reload projects reloaded/statusCode/finalUrl through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'reload_wire_contract';
  __setBrowserForTest(profile, {
    page: {
      url: () => 'https://example.com/',
      reload: async ({ waitUntil }) => {
        assert.equal(waitUntil, 'load');
        return { status: () => 200, ok: () => true };
      },
    },
  });
  const transport = wireTransport((args) => handleCommand('reload', args, daemonContext(profile)));
  const output = await runReload(transport, { profile, named: {} });
  assert.equal(output.cmd, 'reload');
  assert.equal(output.reloaded, true);
  assert.equal(output.statusCode, 200);
  assert.equal(output.finalUrl, 'https://example.com/');
});

test('back/forward/reload belong to the canonical browser command set', () => {
  assert.equal(isBrowserCommand('back'), true);
  assert.equal(isBrowserCommand('forward'), true);
  assert.equal(isBrowserCommand('reload'), true);
});
