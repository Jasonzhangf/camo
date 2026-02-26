import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  captureCheckpoint,
  detectCheckpoint,
  executeOperation,
  restoreCheckpoint,
  validateOperation,
} from '../../../src/container/runtime-core.mjs';

const originalFetch = global.fetch;

describe('runtime core primitives', () => {
  let currentUrl;
  let snapshot;
  let pages;
  let activePageIndex;
  let failNewPage;
  let switchCallCount;
  let viewportSize;
  let windowSize;
  let wheelCalls;
  let commandActions;
  let onWheel;

  beforeEach(() => {
    currentUrl = 'https://www.xiaohongshu.com/explore?keyword=test';
    snapshot = {
      tag: 'body',
      id: null,
      classes: ['feeds-page'],
      children: [
        { tag: 'input', id: 'search-input', classes: ['search-input'] },
      ],
    };
    pages = [{ index: 0, url: currentUrl, active: true }];
    activePageIndex = 0;
    failNewPage = false;
    switchCallCount = 0;
    viewportSize = { width: 1280, height: 720 };
    windowSize = { width: 1400, height: 820 };
    wheelCalls = [];
    commandActions = [];
    onWheel = null;

    global.fetch = async (url, options) => {
      if (String(url).includes('/command')) {
        const body = JSON.parse(options?.body || '{}');
        const action = body.action;
        const args = body.args || {};
        commandActions.push(action);
        if (action === 'getStatus') {
          return { ok: true, json: async () => ({ sessions: [{ profileId: 'p1', sessionId: 's1' }] }) };
        }
        if (action === 'evaluate') {
          if (String(args.script || '').includes('window.location.href')) {
            return { ok: true, json: async () => ({ result: currentUrl }) };
          }
          if (String(args.script || '').includes('innerWidth: window.innerWidth')) {
            return {
              ok: true,
              json: async () => ({
                result: {
                  innerWidth: viewportSize.width,
                  innerHeight: viewportSize.height,
                  outerWidth: windowSize.width,
                  outerHeight: windowSize.height,
                },
              }),
            };
          }
          if (String(args.script || '').includes('window.open(')) {
            const next = pages.length;
            const entry = {
              index: next,
              url: String(currentUrl),
              active: false,
            };
            pages.push(entry);
            return { ok: true, json: async () => ({ result: { opened: true } }) };
          }
          if (String(args.script || '').includes('dom_tree')) {
            return {
              ok: true,
              json: async () => ({ result: { dom_tree: snapshot, viewport: { width: 1280, height: 720 } } }),
            };
          }
          return { ok: true, json: async () => ({ result: { ok: true } }) };
        }
        if (action === 'page:list') {
          const out = pages.map((item) => ({ ...item, active: Number(item.index) === Number(activePageIndex) }));
          return { ok: true, json: async () => ({ pages: out, activeIndex: activePageIndex }) };
        }
        if (action === 'newPage') {
          if (failNewPage) {
            return { ok: false, status: 500, json: async () => ({ error: 'new_tab_failed' }) };
          }
          const next = pages.length;
          const entry = {
            index: next,
            url: String(args?.url || currentUrl),
            active: false,
          };
          pages.push(entry);
          return { ok: true, json: async () => ({ ok: true, page: entry }) };
        }
        if (action === 'page:switch') {
          switchCallCount += 1;
          activePageIndex = Number(args?.index);
          return { ok: true, json: async () => ({ ok: true, activeIndex: activePageIndex }) };
        }
        if (action === 'goto') {
          const nextUrl = String(args?.url || currentUrl);
          currentUrl = nextUrl;
          const activeIdx = pages.findIndex((item) => Number(item.index) === Number(activePageIndex));
          if (activeIdx >= 0) {
            pages[activeIdx] = {
              ...pages[activeIdx],
              url: nextUrl,
              active: true,
            };
          }
          return { ok: true, json: async () => ({ ok: true, url: nextUrl }) };
        }
        if (action === 'page:setViewport') {
          viewportSize = { width: Number(args?.width || viewportSize.width), height: Number(args?.height || viewportSize.height) };
          return { ok: true, json: async () => ({ ok: true, viewport: viewportSize }) };
        }
        if (action === 'window:resize') {
          windowSize = { width: Number(args?.width || windowSize.width), height: Number(args?.height || windowSize.height) };
          return { ok: true, json: async () => ({ ok: true, window: windowSize }) };
        }
        if (action === 'mouse:wheel') {
          const deltaX = Number(args?.deltaX || 0);
          const deltaY = Number(args?.deltaY || 0);
          wheelCalls.push({ deltaX, deltaY });
          if (typeof onWheel === 'function') {
            onWheel({ deltaX, deltaY });
          }
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ ok: true, result: { ok: true } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('detects xhs checkpoint', async () => {
    const result = await detectCheckpoint({ profileId: 'p1', platform: 'xiaohongshu' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.checkpoint, 'search_ready');
  });

  it('returns offsite checkpoint for non-xhs url', async () => {
    currentUrl = 'https://example.com/';
    const result = await detectCheckpoint({ profileId: 'p1', platform: 'xiaohongshu' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.checkpoint, 'offsite');
  });

  it('captures and restores checkpoint with requery_container', async () => {
    const captured = await captureCheckpoint({
      profileId: 'p1',
      selector: '#search-input',
      platform: 'xiaohongshu',
    });
    assert.strictEqual(captured.ok, true);
    assert.strictEqual(captured.data.selectorCount > 0, true);

    const restored = await restoreCheckpoint({
      profileId: 'p1',
      checkpoint: captured.data,
      action: 'requery_container',
      selector: '#search-input',
    });
    assert.strictEqual(restored.ok, true);
  });

  it('validates page/container checks', async () => {
    const pass = await validateOperation({
      profileId: 'p1',
      phase: 'pre',
      validationSpec: {
        mode: 'both',
        pre: {
          page: { hostIncludes: ['xiaohongshu.com'] },
          container: { selector: '#search-input', mustExist: true, minCount: 1 },
        },
      },
    });
    assert.strictEqual(pass.ok, true);

    const fail = await validateOperation({
      profileId: 'p1',
      phase: 'pre',
      validationSpec: {
        mode: 'both',
        pre: {
          page: { urlIncludes: ['not-exist-token'] },
        },
      },
    });
    assert.strictEqual(fail.ok, false);
    assert.strictEqual(fail.code, 'VALIDATION_FAILED');
  });

  it('builds tab pool and switches slots via runtime context', async () => {
    const runtime = {};
    const ensured = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'ensure_tab_pool',
        params: { tabCount: 3, openDelayMs: 0, url: 'https://www.xiaohongshu.com/explore' },
      },
      context: { runtime },
    });
    assert.strictEqual(ensured.ok, true);
    assert.strictEqual(Array.isArray(runtime.tabPool?.slots), true);
    assert.strictEqual(runtime.tabPool.slots.length, 3);
    const switchCallsAfterEnsure = switchCallCount;
    assert.ok(switchCallsAfterEnsure >= 1);

    const switched = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'tab_pool_switch_next',
        params: { settleMs: 0 },
      },
      context: { runtime },
    });
    assert.strictEqual(switched.ok, true);
    assert.strictEqual(Number(switched.data.currentTab.slotIndex), 1);
    assert.strictEqual(switchCallCount, switchCallsAfterEnsure);

    const switchedAgain = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'tab_pool_switch_next',
        params: { settleMs: 0 },
      },
      context: { runtime },
    });
    assert.strictEqual(switchedAgain.ok, true);
    assert.strictEqual(Number(switchedAgain.data.currentTab.slotIndex), 2);
    assert.strictEqual(switchCallCount, switchCallsAfterEnsure + 1);
  });

  it('falls back to window.open when newPage fails', async () => {
    failNewPage = true;
    const runtime = {};
    const ensured = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'ensure_tab_pool',
        params: { tabCount: 2, openDelayMs: 0 },
      },
      context: { runtime },
    });
    assert.strictEqual(ensured.ok, true);
    assert.strictEqual(runtime.tabPool.slots.length, 2);
  });

  it('normalizes xhs detail seed url to explore list when building tab pool', async () => {
    currentUrl = 'https://www.xiaohongshu.com/explore/6974168d000000000e00dfc0?xsec_token=token';
    pages = [{ index: 0, url: currentUrl, active: true }];
    activePageIndex = 0;
    const runtime = {};
    const ensured = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'ensure_tab_pool',
        params: { tabCount: 2, openDelayMs: 0 },
      },
      context: { runtime },
    });
    assert.strictEqual(ensured.ok, true);
    assert.strictEqual(runtime.tabPool.slots.length, 2);
    assert.strictEqual(
      runtime.tabPool.slots.every((item) => String(item.url).startsWith('https://www.xiaohongshu.com/explore')),
      true,
    );
    assert.strictEqual(
      runtime.tabPool.slots.every((item) => !String(item.url).includes('/explore/6974168d')),
      true,
    );
  });

  it('syncs window and viewport before runtime actions', async () => {
    viewportSize = { width: 1100, height: 700 };
    windowSize = { width: 2600, height: 1600 };
    const synced = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'sync_window_viewport',
        params: { width: 1440, height: 900, attempts: 2, settleMs: 0 },
      },
      context: { runtime: {} },
    });
    assert.strictEqual(synced.ok, true);
    assert.strictEqual(viewportSize.width, 1440);
    assert.strictEqual(viewportSize.height, 900);
    assert.strictEqual(Number(synced.data.width), 1440);
    assert.strictEqual(Number(synced.data.height), 900);
  });

  it('syncs viewport to current window when followWindow is enabled', async () => {
    viewportSize = { width: 1024, height: 640 };
    windowSize = { width: 1400, height: 820 };
    const synced = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'sync_window_viewport',
        params: { followWindow: true },
      },
      context: { runtime: {} },
    });
    assert.strictEqual(synced.ok, true);
    assert.strictEqual(synced.data.followWindow, true);
    assert.strictEqual(synced.data.viewport.width, 1280);
    assert.strictEqual(synced.data.viewport.height, 640);
  });

  it('gets current url and validates tokens', async () => {
    const ok = await executeOperation({
      profileId: 'p1',
      operation: { action: 'get_current_url', params: { includes: ['xiaohongshu.com'] } },
      context: { runtime: {} },
    });
    assert.strictEqual(ok.ok, true);
    assert.ok(String(ok.data.url).includes('xiaohongshu.com'));

    const bad = await executeOperation({
      profileId: 'p1',
      operation: { action: 'get_current_url', params: { includes: ['not-exist-token'] } },
      context: { runtime: {} },
    });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.code, 'URL_MISMATCH');
  });

  it('supports scroll and press_key operations', async () => {
    const scrolled = await executeOperation({
      profileId: 'p1',
      operation: { action: 'scroll', params: { direction: 'down', amount: 420 } },
      context: { runtime: {} },
    });
    assert.strictEqual(scrolled.ok, true);
    assert.strictEqual(wheelCalls.length, 1);
    assert.strictEqual(wheelCalls[0].deltaY, 420);

    const pressed = await executeOperation({
      profileId: 'p1',
      operation: { action: 'press_key', params: { key: 'Enter' } },
      context: { runtime: {} },
    });
    assert.strictEqual(pressed.ok, true);
  });

  it('auto-scrolls click target until fully visible', async () => {
    snapshot = {
      tag: 'body',
      selector: 'body',
      visible: true,
      children: [
        {
          tag: 'button',
          selector: '.edge-target',
          classes: ['edge-target'],
          visible: true,
          rect: { left: 240, top: -120, width: 220, height: 120 },
        },
      ],
    };
    onWheel = ({ deltaY }) => {
      if (deltaY < 0) {
        snapshot.children[0].rect.top = 80;
      }
    };
    commandActions.length = 0;
    const result = await executeOperation({
      profileId: 'p1',
      operation: { action: 'click', params: { selector: '.edge-target' } },
      context: { runtime: {} },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.targetFullyVisible, true);
    assert.ok(wheelCalls.some((item) => item.deltaY < 0));
    assert.ok(commandActions.includes('mouse:click'));
  });

  it('fails click when target is still not fully visible after auto-scroll retries', async () => {
    snapshot = {
      tag: 'body',
      selector: 'body',
      visible: true,
      children: [
        {
          tag: 'button',
          selector: '.always-partial',
          classes: ['always-partial'],
          visible: true,
          rect: { left: 260, top: -140, width: 220, height: 120 },
        },
      ],
    };
    const result = await executeOperation({
      profileId: 'p1',
      operation: { action: 'click', params: { selector: '.always-partial', maxScrollSteps: 3, scrollSettleMs: 0 } },
      context: { runtime: {} },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'TARGET_NOT_FULLY_VISIBLE');
    assert.strictEqual(commandActions.includes('mouse:click'), false);
    assert.strictEqual(wheelCalls.length, 3);
  });

  it('uses direct click without mouse move', async () => {
    snapshot = {
      tag: 'body',
      selector: 'body',
      visible: true,
      children: [
        {
          tag: 'button',
          selector: '.move-fallback',
          classes: ['move-fallback'],
          visible: true,
          rect: { left: 260, top: 200, width: 220, height: 120 },
        },
      ],
    };
    commandActions.length = 0;
    const result = await executeOperation({
      profileId: 'p1',
      operation: { action: 'click', params: { selector: '.move-fallback' } },
      context: { runtime: {} },
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(commandActions.filter((action) => action.startsWith('mouse:')), ['mouse:click']);
  });

  it('locks scroll anchor to modal in strict filter mode', async () => {
    snapshot = {
      tag: 'body',
      selector: 'body',
      visible: true,
      children: [
        {
          tag: 'div',
          selector: '.note-detail-mask',
          classes: ['note-detail-mask'],
          visible: true,
          rect: { left: 60, top: 40, width: 900, height: 600 },
          children: [
            {
              tag: 'button',
              selector: '.inside-action',
              classes: ['inside-action'],
              visible: true,
              rect: { left: 120, top: 120, width: 120, height: 40 },
            },
          ],
        },
        {
          tag: 'div',
          selector: '.feed-list',
          classes: ['feed-list'],
          visible: true,
          rect: { left: 980, top: 140, width: 260, height: 420 },
        },
      ],
    };
    const result = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'scroll',
        params: { direction: 'down', amount: 240, selector: '.feed-list', filterMode: 'strict' },
      },
      context: { runtime: {} },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.anchorSource, 'modal');
    assert.strictEqual(result.data.modalLocked, true);
  });

  it('rejects selector operations outside modal in strict filter mode', async () => {
    snapshot = {
      tag: 'body',
      selector: 'body',
      visible: true,
      children: [
        {
          tag: 'div',
          selector: '.note-detail-mask',
          classes: ['note-detail-mask'],
          visible: true,
          rect: { left: 60, top: 40, width: 900, height: 600 },
          children: [
            {
              tag: 'button',
              selector: '.inside-action',
              classes: ['inside-action'],
              visible: true,
              rect: { left: 120, top: 120, width: 120, height: 40 },
            },
          ],
        },
        {
          tag: 'button',
          selector: '.outside-target',
          classes: ['outside-target'],
          visible: true,
          rect: { left: 1000, top: 300, width: 120, height: 48 },
        },
      ],
    };
    const result = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'click',
        params: { selector: '.outside-target', filterMode: 'strict' },
      },
      context: { runtime: {} },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'OPERATION_FAILED');
    assert.ok(String(result.message).includes('Modal focus locked'));
  });

  it('types through device chain with direct focus click by default', async () => {
    snapshot = {
      tag: 'body',
      selector: 'body',
      visible: true,
      children: [
        {
          tag: 'input',
          selector: '#search-input',
          id: 'search-input',
          visible: true,
          rect: { left: 260, top: 180, width: 320, height: 42 },
        },
      ],
    };
    commandActions.length = 0;
    const result = await executeOperation({
      profileId: 'p1',
      operation: { action: 'type', params: { selector: '#search-input', text: 'deepseek' } },
      context: { runtime: {} },
    });
    assert.strictEqual(result.ok, true);
    const clickIdx = commandActions.indexOf('mouse:click');
    const typeIdx = commandActions.indexOf('keyboard:type');
    assert.deepStrictEqual(commandActions.filter((action) => action.startsWith('mouse:')), ['mouse:click']);
    assert.ok(clickIdx >= 0);
    assert.ok(typeIdx > clickIdx);
  });

  it('verifies subscription selectors across pages', async () => {
    pages = [
      { index: 0, url: currentUrl, active: true },
      { index: 1, url: currentUrl, active: false },
    ];
    activePageIndex = 0;
    const verified = await executeOperation({
      profileId: 'p1',
      operation: {
        action: 'verify_subscriptions',
        params: {
          acrossPages: true,
          selectors: ['#search-input'],
        },
      },
      context: { runtime: {} },
    });
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(Array.isArray(verified.data.pages), true);
    assert.strictEqual(verified.data.pages.length, 2);
  });
});
