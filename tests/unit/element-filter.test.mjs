import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ElementFilter, createElementFilter } from '../../src/container/element-filter.mjs';

describe('ElementFilter', () => {
  let filter;
  beforeEach(() => {
    filter = new ElementFilter({ viewportMargin: 10, minVisibleRatio: 0.5 });
  });

  describe('isInViewport', () => {
    it('should return true for element fully inside viewport', () => {
      const rect = { left: 100, right: 200, top: 100, bottom: 200, width: 100, height: 100 };
      const viewport = { width: 800, height: 600 };
      assert.strictEqual(filter.isInViewport(rect, viewport), true);
    });

    it('should return true for element partially inside with margin', () => {
      const rect = { left: -5, right: 50, top: 10, bottom: 100, width: 55, height: 90 };
      const viewport = { width: 800, height: 600 };
      assert.strictEqual(filter.isInViewport(rect, viewport), true);
    });

    it('should return false for element far outside viewport', () => {
      const rect = { left: -1000, right: -900, top: 0, bottom: 100, width: 100, height: 100 };
      const viewport = { width: 800, height: 600 };
      assert.strictEqual(filter.isInViewport(rect, viewport), false);
    });
  });

  describe('getVisibilityRatio', () => {
    it('should return 1 for fully visible element', () => {
      const rect = { left: 100, right: 200, top: 100, bottom: 200, width: 100, height: 100 };
      const viewport = { width: 800, height: 600 };
      assert.strictEqual(filter.getVisibilityRatio(rect, viewport), 1);
    });

    it('should return correct ratio for partially visible element', () => {
      const rect = { left: 700, right: 900, top: 500, bottom: 700, width: 200, height: 200 };
      const viewport = { width: 800, height: 600 };
      // visible portion: right part: from 700 to 800, width 100; bottom part: from 500 to 600, height 100; area 10000, total area 40000, ratio 0.25
      const ratio = filter.getVisibilityRatio(rect, viewport);
      assert.strictEqual(ratio, 0.25);
    });

    it('should return 0 for non-visible element', () => {
      const rect = { left: -100, right: -50, top: 0, bottom: 100, width: 50, height: 100 };
      const viewport = { width: 800, height: 600 };
      assert.strictEqual(filter.getVisibilityRatio(rect, viewport), 0);
    });
  });

  describe('matchesSelector', () => {
    it('should match by css selector', () => {
      const element = { selector: '.test' };
      const selector = { css: '.test' };
      assert.strictEqual(filter.matchesSelector(element, selector), true);
    });

    it('should match by id', () => {
      const element = { id: 'test-id' };
      const selector = { id: 'test-id' };
      assert.strictEqual(filter.matchesSelector(element, selector), true);
    });

    it('should match by classes', () => {
      const element = { classes: ['class1', 'class2'] };
      const selector = { classes: ['class1', 'class2'] };
      assert.strictEqual(filter.matchesSelector(element, selector), true);
    });

    it('should return false when no match', () => {
      const element = { classes: ['class1'] };
      const selector = { classes: ['class2'] };
      assert.strictEqual(filter.matchesSelector(element, selector), false);
    });

    it('should match css id selector by element id', () => {
      const element = { id: 'search-input', tag: 'input', classes: ['search-input'] };
      const selector = { css: '#search-input' };
      assert.strictEqual(filter.matchesSelector(element, selector), true);
    });

    it('should match css tag+class selector', () => {
      const element = { id: null, tag: 'input', classes: ['search-input'] };
      const selector = { css: 'input.search-input' };
      assert.strictEqual(filter.matchesSelector(element, selector), true);
    });
  });

  describe('filterByContainer', () => {
    it('should return matching elements', () => {
      const elements = [
        { id: 'el1', classes: ['a'] },
        { id: 'el2', classes: ['b'] },
        { id: 'el3', classes: ['a', 'b'] },
      ];
      const containerDef = {
        selectors: [
          { classes: ['a'] },
          { classes: ['b'] },
        ],
      };
      const result = filter.filterByContainer(elements, containerDef);
      assert.strictEqual(result.length, 3); // all elements match either a or b
    });
  });

  describe('filter', () => {
    it('should filter by container and visibility', () => {
      const elements = [
        { rect: { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 }, classes: ['visible'] },
        { rect: { left: -100, right: 0, top: 0, bottom: 100, width: 100, height: 100 }, classes: ['partially-visible'] },
        { rect: { left: 1000, right: 1100, top: 0, bottom: 100, width: 100, height: 100 }, classes: ['invisible'] },
      ];
      const containerDef = {
        selectors: [
          { classes: ['visible'] },
          { classes: ['partially-visible'] },
          { classes: ['invisible'] },
        ],
      };
      const viewport = { width: 800, height: 600 };
      const result = filter.filter(elements, { container: containerDef, viewport, requireVisible: true, minVisibleRatio: 0.1 });
      // 第一个完全可见，第二个部分可见（左边有一部分在视口内，面积>0.1？需要计算），第三个不可见
      // 第二个rect left -100 right 0 => visible width 0? 实际上 left -100, right 0，在视口内只有从0到0，面积0，所以不可见。这里需要调整测试数据，使第二个部分可见。
      // 为了简单，我们调整第二个为部分可见：left -20, right 80 => 可见宽度80，高度100，面积8000，总面积10000，ratio 0.8 > 0.1
      elements[1].rect = { left: -20, right: 80, top: 0, bottom: 100, width: 100, height: 100 };
      const result2 = filter.filter(elements, { container: containerDef, viewport, requireVisible: true, minVisibleRatio: 0.1 });
      assert.strictEqual(result2.length, 2); // first and second
      assert.strictEqual(result2[0].element.classes[0], 'visible');
      assert.strictEqual(result2[1].element.classes[0], 'partially-visible');
    });
  });
});
