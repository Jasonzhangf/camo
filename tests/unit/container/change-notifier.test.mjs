import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ChangeNotifier, getChangeNotifier, destroyChangeNotifier } from '../../../src/container/change-notifier.mjs';

describe('ChangeNotifier', () => {
  let notifier;

  beforeEach(() => {
    notifier = new ChangeNotifier();
  });

  afterEach(() => {
    notifier.destroy();
  });

  describe('subscribe', () => {
    it('should subscribe to a topic', () => {
      let called = false;
      notifier.subscribe('test-topic', () => { called = true; });
      notifier.notify('test-topic', { data: 'test' });
      assert.strictEqual(called, true);
    });

    it('should return unsubscribe function', () => {
      let callCount = 0;
      const unsub = notifier.subscribe('test-topic', () => { callCount++; });
      notifier.notify('test-topic', {});
      assert.strictEqual(callCount, 1);
      unsub();
      notifier.notify('test-topic', {});
      assert.strictEqual(callCount, 1);
    });

    it('should support multiple subscribers', () => {
      const results = [];
      notifier.subscribe('topic', () => results.push(1));
      notifier.subscribe('topic', () => results.push(2));
      notifier.notify('topic', {});
      assert.deepStrictEqual(results.sort(), [1, 2]);
    });

    it('should not throw on non-existent topic', () => {
      assert.doesNotThrow(() => notifier.notify('no-topic', {}));
    });
  });

  describe('selector matching', () => {
    it('should match css id selector via node id', () => {
      const node = { id: 'search-input', tag: 'input', classes: ['search-input'] };
      assert.strictEqual(notifier.nodeMatchesSelector(node, { css: '#search-input' }), true);
    });

    it('should match css tag+class selector', () => {
      const node = { id: null, tag: 'input', classes: ['search-input'] };
      assert.strictEqual(notifier.nodeMatchesSelector(node, { css: 'input.search-input' }), true);
    });

    it('should not match when tag differs', () => {
      const node = { id: 'search-input', tag: 'div', classes: ['search-input'] };
      assert.strictEqual(notifier.nodeMatchesSelector(node, { css: 'input.search-input' }), false);
    });

    it('should match class contains selector only when class value matches', () => {
      const matched = { tag: 'div', id: null, classes: ['captcha-container'] };
      const unmatched = { tag: 'div', id: null, classes: ['container'] };
      assert.strictEqual(notifier.nodeMatchesSelector(matched, { css: '[class*="captcha"]' }), true);
      assert.strictEqual(notifier.nodeMatchesSelector(unmatched, { css: '[class*="captcha"]' }), false);
    });

    it('should match href contains selector using snapshot attrs', () => {
      const node = {
        tag: 'a',
        id: null,
        classes: ['link-wrapper'],
        attrs: { href: '/explore?channel_id=homefeed_recommend' },
      };
      assert.strictEqual(notifier.nodeMatchesSelector(node, { css: 'a[href*="/explore?channel_id=homefeed_recommend"]' }), true);
      assert.strictEqual(notifier.nodeMatchesSelector(node, { css: 'a[href*="/note/"]' }), false);
    });

    it('should not treat attribute-only selector as match-all', () => {
      const node = { tag: 'body', id: null, classes: [] };
      assert.strictEqual(notifier.nodeMatchesSelector(node, { css: '[class*="captcha"]' }), false);
    });
  });

  describe('watch', () => {
    it('should honor throttle for onChange callbacks', () => {
      let onChangeCount = 0;
      const originalNow = Date.now;
      let now = 1000;
      Date.now = () => now;

      try {
        notifier.watch({ css: '#search-input' }, {
          throttle: 1000,
          onChange: () => { onChangeCount += 1; },
        });

        notifier.processSnapshot({
          tag: 'body',
          children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }],
        });

        now = 2000;
        notifier.processSnapshot({ tag: 'body', children: [] });
        assert.strictEqual(onChangeCount, 1);

        now = 2500;
        notifier.processSnapshot({
          tag: 'body',
          children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }],
        });
        assert.strictEqual(onChangeCount, 1);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('visibility semantics', () => {
    it('filters hidden matches by default and supports visible=false override', () => {
      const snapshot = {
        tag: 'body',
        __viewport: { width: 1280, height: 720 },
        children: [
          { tag: 'input', id: 'search-input', classes: ['search-input'], visible: false, rect: { left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 } },
          { tag: 'input', id: 'search-input-2', classes: ['search-input'], visible: true, rect: { left: 10, top: 50, right: 210, bottom: 80, width: 200, height: 30 } },
        ],
      };

      const visibleOnly = notifier.findElements(snapshot, { css: '#search-input' });
      assert.strictEqual(visibleOnly.length, 0);

      const includeHidden = notifier.findElements(snapshot, { css: '#search-input', visible: false });
      assert.strictEqual(includeHidden.length, 1);
      assert.strictEqual(includeHidden[0].id, 'search-input');
    });

    it('treats visibility loss as disappear for watcher events', () => {
      let appearCount = 0;
      let disappearCount = 0;
      notifier.watch({ css: '#search-input' }, {
        throttle: 0,
        onAppear: () => { appearCount += 1; },
        onDisappear: () => { disappearCount += 1; },
      });

      notifier.processSnapshot({
        tag: 'body',
        __viewport: { width: 1280, height: 720 },
        children: [
          { tag: 'input', id: 'search-input', classes: ['search-input'], visible: true, rect: { left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 } },
        ],
      });
      notifier.processSnapshot({
        tag: 'body',
        __viewport: { width: 1280, height: 720 },
        children: [
          { tag: 'input', id: 'search-input', classes: ['search-input'], visible: false, rect: { left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 } },
        ],
      });

      assert.strictEqual(appearCount, 0);
      assert.strictEqual(disappearCount, 1);
    });
  });
});
