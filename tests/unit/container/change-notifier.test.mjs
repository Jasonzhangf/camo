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
});
