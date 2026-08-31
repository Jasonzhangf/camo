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

test('hover belongs to the canonical ephemeral browser command set', () => {
  assert.equal(isBrowserCommand('hover'), true);
  assert.equal(isBrowserCommand('get-page-info'), false);
});
