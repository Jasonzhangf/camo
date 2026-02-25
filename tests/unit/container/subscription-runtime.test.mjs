import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { watchSubscriptions } from '../../../src/container/runtime-core/subscription.mjs';

const originalFetch = global.fetch;

describe('runtime-core subscription watch', () => {
  let currentUrl;
  let snapshots;
  let snapshotIndex;

  beforeEach(() => {
    currentUrl = 'https://www.xiaohongshu.com/explore?keyword=ai';
    snapshots = [];
    snapshotIndex = 0;

    global.fetch = async (url, options = {}) => {
      if (!String(url).includes('/command')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const body = JSON.parse(options.body || '{}');
      const action = body.action;
      const args = body.args || {};
      if (action === 'getStatus') {
        return { ok: true, status: 200, json: async () => ({ sessions: [{ profileId: 'p1', sessionId: 's1' }] }) };
      }
      if (action === 'evaluate') {
        if (String(args.script || '').includes('window.location.href')) {
          return { ok: true, status: 200, json: async () => ({ result: currentUrl }) };
        }
        if (String(args.script || '').includes('dom_tree')) {
          const snap = snapshots[Math.min(snapshotIndex, Math.max(0, snapshots.length - 1))] || { tag: 'body', children: [] };
          snapshotIndex += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({ result: { dom_tree: snap, viewport: { width: 1280, height: 720 } } }),
          };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('enforces strict visible matching and url filter gating', async () => {
    snapshots = [
      {
        tag: 'body',
        children: [
          {
            tag: 'div',
            selector: '#target',
            id: 'target',
            visible: true,
            rect: { left: 40, top: 40, width: 120, height: 40 },
          },
        ],
      },
      {
        tag: 'body',
        children: [
          {
            tag: 'div',
            selector: '#target',
            id: 'target',
            visible: true,
            rect: { left: 40, top: 40, width: 120, height: 40 },
          },
        ],
      },
    ];
    const events = [];
    const handle = await watchSubscriptions({
      profileId: 'p1',
      filterMode: 'strict',
      throttle: 100,
      subscriptions: [
        {
          id: 'target',
          selector: '#target',
          events: ['appear', 'disappear'],
          pageUrlIncludes: ['keyword=ai'],
          pageUrlExcludes: ['blocked=1'],
        },
      ],
      onEvent: async (event) => {
        events.push(event);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 130));
    currentUrl = 'https://www.xiaohongshu.com/explore?keyword=ai&blocked=1';
    await new Promise((resolve) => setTimeout(resolve, 160));
    handle.stop();

    const appear = events.find((item) => item.type === 'appear');
    const disappear = events.find((item) => item.type === 'disappear');
    assert.ok(appear);
    assert.ok(disappear);
    assert.strictEqual(appear.filterMode, 'strict');
    assert.ok(String(appear.pageUrl).includes('keyword=ai'));
    assert.ok(String(disappear.pageUrl).includes('blocked=1'));
  });

  it('allows visible:false subscription only in legacy mode', async () => {
    snapshots = [
      {
        tag: 'body',
        children: [
          {
            tag: 'div',
            selector: '#hidden-target',
            id: 'hidden-target',
            visible: false,
            rect: { left: 40, top: 40, width: 120, height: 40 },
          },
        ],
      },
    ];

    const strictEvents = [];
    const strictHandle = await watchSubscriptions({
      profileId: 'p1',
      filterMode: 'strict',
      throttle: 100,
      subscriptions: [{ id: 'hidden', selector: '#hidden-target', visible: false, events: ['appear'] }],
      onEvent: async (event) => strictEvents.push(event),
    });
    await new Promise((resolve) => setTimeout(resolve, 130));
    strictHandle.stop();
    assert.strictEqual(strictEvents.some((item) => item.type === 'appear'), false);

    snapshotIndex = 0;
    const legacyEvents = [];
    const legacyHandle = await watchSubscriptions({
      profileId: 'p1',
      filterMode: 'legacy',
      throttle: 100,
      subscriptions: [{ id: 'hidden', selector: '#hidden-target', visible: false, events: ['appear'] }],
      onEvent: async (event) => legacyEvents.push(event),
    });
    await new Promise((resolve) => setTimeout(resolve, 130));
    legacyHandle.stop();
    const appear = legacyEvents.find((item) => item.type === 'appear');
    assert.ok(appear);
    assert.strictEqual(appear.filterMode, 'legacy');
  });
});
