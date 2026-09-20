import test from 'node:test';
import assert from 'node:assert/strict';

import { run as runBack } from '../../commands/builtins/back.mjs';
import { run as runForward } from '../../commands/builtins/forward.mjs';
import { run as runReload } from '../../commands/builtins/reload.mjs';
import { run as runScroll } from '../../commands/builtins/scroll.mjs';
import { run as runType } from '../../commands/builtins/type.mjs';
import { run as runClick } from '../../commands/builtins/click.mjs';
import { run as runUpload } from '../../commands/builtins/upload.mjs';
import { run as runSelect } from '../../commands/builtins/select.mjs';
import { handleCommand } from '../../shell/daemon/command_handlers.mjs';
import { isBrowserCommand } from '../../shell/daemon/browser_commands.mjs';
import { __enableTestRoot as enablePipeline } from '../../services/page_runtime/input_pipeline.mjs';
import * as bootstrap from '../../services/browser_service/bootstrap.mjs';
import * as session from '../../services/session/manager.mjs';
import {
  __enableTestRoot as enableBridge,
  __setBrowserForTest,
} from '../../services/browser_service/internal/camoufox_bridge.mjs';

bootstrap.__enableTestRoot();
await bootstrap.enableAllOwners();
session.__enableTestRoot();

function allocateTarget(profileId, page) {
  const existing = session.tryRead(profileId);
  const record = existing || session.create(profileId, {
    instanceId: `wire-${profileId}`,
    generation: Date.now(),
  });
  return session.allocateTarget(record.profileId, page);
}

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

test.after(() => {
  session.__resetForTest();
});

test('tab command projections preserve count and closed truth', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'tabs_wire_contract';
  const closedPages = [];
  const first = { url: () => 'https://example.com/', title: async () => 'Example', close: async () => closedPages.push('https://example.com/') };
  const second = { url: () => 'https://news.ycombinator.com/', title: async () => 'Hacker News', close: async () => closedPages.push('https://news.ycombinator.com/') };
  const pages = [first, second];
  __setBrowserForTest(profile, {
    context: {
      pages: () => pages,
    },
  });
  const firstTarget = allocateTarget(profile, first);
  const secondTarget = allocateTarget(profile, second);

  const listed = await handleCommand('list-tabs', { profile }, daemonContext(profile));
  assert.equal(listed.ok, true);
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.tabs.map((tab) => tab.url), [
    'https://example.com/',
    'https://news.ycombinator.com/',
  ]);
  assert.deepEqual(listed.tabs.map((tab) => tab.target), [firstTarget.targetId, secondTarget.targetId]);

  const closed = await handleCommand('close-tab', { profile, target: secondTarget.targetId }, daemonContext(profile));
  assert.equal(closed.ok, true);
  assert.equal(closed.closed, true);
  assert.equal(closed.target, secondTarget.targetId);
  assert.equal(closed.page, secondTarget.pageId);
  assert.deepEqual(closedPages, ['https://news.ycombinator.com/']);
});

test('negative: list-tabs preserves stale and cross-profile target errors', async () => {
  enablePipeline();
  enableBridge();
  const owner = 'list_tabs_target_owner';
  const other = 'list_tabs_target_other';
  const page = {
    url: () => 'https://example.com/',
    title: async () => 'Example',
  };
  __setBrowserForTest(owner, { page });
  const target = allocateTarget(owner, page);

  await assert.rejects(
    () => handleCommand('list-tabs', { profile: other, target: target.targetId }, daemonContext(other)),
    (cause) => cause?.code === 'E_STATE_INVALID'
      && cause.details.resource === 'browser_target'
      && cause.details.reason === 'target belongs to a different profile',
  );

  session.invalidateTarget(target.targetId);
  await assert.rejects(
    () => handleCommand('list-tabs', { profile: owner, target: target.targetId }, daemonContext(owner)),
    (cause) => cause?.code === 'E_STATE_INVALID'
      && cause.details.resource === 'browser_target'
      && /stale/.test(cause.details.reason),
  );
});

test('switch-tab brings the target page to front', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'switch_tabs_wire_contract';
  const fronted = [];
  const first = {
    url: () => 'https://example.com/',
    title: async () => 'Example',
    bringToFront: async () => fronted.push('https://example.com/'),
  };
  const second = {
    url: () => 'https://news.ycombinator.com/',
    title: async () => 'Hacker News',
    bringToFront: async () => fronted.push('https://news.ycombinator.com/'),
  };
  const pages = [first, second];
  __setBrowserForTest(profile, {
    context: { pages: () => pages },
  });
  const target = allocateTarget(profile, second);

  const switched = await handleCommand('switch-tab', { profile, target: target.targetId }, daemonContext(profile));
  assert.equal(switched.ok, true);
  assert.equal(switched.switched, true);
  assert.equal(switched.target, target.targetId);
  assert.equal(switched.page, target.pageId);
  assert.equal(switched.url, 'https://news.ycombinator.com/');
  assert.deepEqual(fronted, ['https://news.ycombinator.com/']);
});

test('scroll preserves CLI dx/dy through daemon to protocol wheel', async () => {
  enablePipeline();
  enableBridge();
  const wheelCalls = [];
  const profile = 'scroll_wire_contract';
  const page = {
    viewportSize: () => ({ width: 800, height: 600 }),
    mouse: {
      move: async () => {},
      wheel: async (x, y) => wheelCalls.push([x, y]),
    },
  };
  __setBrowserForTest(profile, {
    page,
  });
  const target = allocateTarget(profile, page);
  const transport = wireTransport((args) => handleCommand('scroll', args, daemonContext(profile)));
  await runScroll(transport, { profile, named: { target: target.targetId, x: 17, y: 91 } });
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
  const target = allocateTarget(profile, {
    keyboard: { press: async () => {}, type: async () => {} },
  });
  const transport = wireTransport((args) => handleCommand('type', args, daemonContext(profile)));
  const output = await runType(transport, { profile, positional: ['Jason'], named: { target: target.targetId } });
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
  const target = allocateTarget(profile, {
    url: () => 'https://example.com/',
    content: async () => '<html><body>Example</body></html>',
  });
  const result = await handleCommand('snapshot', { profile, target: target.targetId }, daemonContext(profile));
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
  const page = {
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
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  const transport = wireTransport((args) => handleCommand('click', args, daemonContext(profile)));

  await assert.rejects(
    () => runClick(transport, { profile, named: { target: target.targetId, selector: '#target', timeout: 20 } }),
    (cause) => cause?.code === 'E_IO_TIMEOUT',
  );
  const info = await handleCommand('get-page-info', { profile }, daemonContext(profile));
  assert.equal(info.ok, true);
});
test('hover belongs to the canonical ephemeral browser command set', () => {
  assert.equal(isBrowserCommand('hover'), true);
  assert.equal(isBrowserCommand('get-page-info'), true);
});

test('back projects navigated/finalUrl through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'back_wire_contract';
  const page = {
      url: () => 'https://example.com/',
      goBack: async () => ({ status: () => 200, ok: () => true }),
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  const transport = wireTransport((args) => handleCommand('back', args, daemonContext(profile)));
  const output = await runBack(transport, { profile, named: { target: target.targetId } });
  assert.equal(output.cmd, 'back');
  assert.equal(output.profile, profile);
  assert.equal(output.navigated, true);
  assert.equal(output.finalUrl, 'https://example.com/');
});

test('back reports navigated=false when there is no previous history entry', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'back_empty_wire_contract';
  const page = {
      url: () => 'https://example.com/',
      goBack: async () => null,
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  const transport = wireTransport((args) => handleCommand('back', args, daemonContext(profile)));
  const output = await runBack(transport, { profile, named: { target: target.targetId } });
  assert.equal(output.navigated, false);
});

test('forward projects navigated/finalUrl through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'forward_wire_contract';
  const page = {
      url: () => 'https://example.com/',
      goForward: async () => ({ status: () => 200, ok: () => true }),
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  const transport = wireTransport((args) => handleCommand('forward', args, daemonContext(profile)));
  const output = await runForward(transport, { profile, named: { target: target.targetId } });
  assert.equal(output.cmd, 'forward');
  assert.equal(output.navigated, true);
  assert.equal(output.finalUrl, 'https://example.com/');
});

test('reload projects reloaded/statusCode/finalUrl through the daemon wire', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'reload_wire_contract';
  const page = {
      url: () => 'https://example.com/',
      reload: async ({ waitUntil }) => {
        assert.equal(waitUntil, 'load');
        return { status: () => 200, ok: () => true };
      },
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  const transport = wireTransport((args) => handleCommand('reload', args, daemonContext(profile)));
  const output = await runReload(transport, { profile, named: { target: target.targetId } });
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

test('upload/select forward the explicit target to the resolved page', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'upload_select_wire_contract';
  const uploadCalls = [];
  const selectCalls = [];
  const page = {
    locator: () => ({
      setInputFiles: async (files) => uploadCalls.push(files),
      selectOption: async (value) => selectCalls.push(value),
    }),
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  const context = daemonContext(profile);

  const uploadTransport = wireTransport((args) => handleCommand('upload', args, context));
  const uploadOut = await runUpload(uploadTransport, {
    profile,
    named: { target: target.targetId, selector: '#file', file: '/tmp/report.pdf' },
  });
  assert.equal(uploadOut.target, target.targetId);
  assert.equal(uploadOut.uploaded, true);
  assert.deepEqual(uploadCalls, [['/tmp/report.pdf']]);

  const selectTransport = wireTransport((args) => handleCommand('select', args, context));
  const selectOut = await runSelect(selectTransport, {
    profile,
    named: { target: target.targetId, selector: '#country', value: 'US' },
  });
  assert.equal(selectOut.target, target.targetId);
  assert.equal(selectOut.selected, true);
  assert.deepEqual(selectCalls, ['US']);
});

test('negative: upload/select reject a stale target without touching a page', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'upload_select_stale_contract';
  const page = {
    locator: () => ({
      setInputFiles: async () => { throw new Error('must not reach the page'); },
      selectOption: async () => { throw new Error('must not reach the page'); },
    }),
  };
  __setBrowserForTest(profile, { page });
  const target = allocateTarget(profile, page);
  session.invalidateTarget(target.targetId);

  await assert.rejects(
    () => handleCommand('upload', { profile, target: target.targetId, selector: '#file', files: ['/tmp/x'] }, daemonContext(profile)),
    (cause) => cause?.code === 'E_STATE_INVALID' && /stale/.test(cause.details.reason),
  );
  await assert.rejects(
    () => handleCommand('select', { profile, target: target.targetId, selector: '#country', value: 'US' }, daemonContext(profile)),
    (cause) => cause?.code === 'E_STATE_INVALID' && /stale/.test(cause.details.reason),
  );
});

test('negative: upload/select reject a target owned by another profile', async () => {
  enablePipeline();
  enableBridge();
  const owner = 'upload_select_owner';
  const other = 'upload_select_other';
  const page = {
    locator: () => ({
      setInputFiles: async () => { throw new Error('must not reach the page'); },
      selectOption: async () => { throw new Error('must not reach the page'); },
    }),
  };
  __setBrowserForTest(owner, { page });
  const target = allocateTarget(owner, page);

  await assert.rejects(
    () => handleCommand('upload', { profile: other, target: target.targetId, selector: '#file', files: ['/tmp/x'] }, daemonContext(other)),
    (cause) => cause?.code === 'E_STATE_INVALID'
      && cause.details.resource === 'browser_target'
      && cause.details.reason === 'target belongs to a different profile',
  );
  await assert.rejects(
    () => handleCommand('select', { profile: other, target: target.targetId, selector: '#country', value: 'US' }, daemonContext(other)),
    (cause) => cause?.code === 'E_STATE_INVALID'
      && cause.details.resource === 'browser_target'
      && cause.details.reason === 'target belongs to a different profile',
  );
});

test('negative: multiple active targets require an explicit --target', async () => {
  enablePipeline();
  enableBridge();
  const profile = 'multi_target_ambiguity_contract';
  const first = { content: async () => '<html>first</html>', url: () => 'https://example.com/1' };
  const second = { content: async () => '<html>second</html>', url: () => 'https://example.com/2' };
  __setBrowserForTest(profile, { page: first, context: { pages: () => [first, second] } });
  const firstTarget = allocateTarget(profile, first);
  const secondTarget = allocateTarget(profile, second);

  await assert.rejects(
    () => handleCommand('snapshot', { profile }, daemonContext(profile)),
    (cause) => cause?.code === 'E_STATE_INVALID' && /multiple active targets/.test(cause.details.reason),
  );

  const one = await handleCommand('snapshot', { profile, target: firstTarget.targetId }, daemonContext(profile));
  const two = await handleCommand('snapshot', { profile, target: secondTarget.targetId }, daemonContext(profile));
  assert.equal(one.html, '<html>first</html>');
  assert.equal(two.html, '<html>second</html>');
});
