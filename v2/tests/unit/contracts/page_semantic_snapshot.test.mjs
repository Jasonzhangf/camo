import test from 'node:test';
import assert from 'node:assert/strict';
import { stableLocatorFor } from '../../../contracts/page_semantic_snapshot/index.mjs';

test('stableLocatorFor escapes CSS metacharacters in DOM ids', () => {
  const runtimeNode = {
    el: {
      tagName: 'BUTTON',
      id: '1.a:b[c] d',
      getAttribute: () => null,
    },
  };
  assert.equal(stableLocatorFor(runtimeNode), '#\\31 \\.a\\:b\\[c\\]\\ d');
});

test('stableLocatorFor escapes data-testid and aria-label attribute values', () => {
  assert.equal(stableLocatorFor({
    el: {
      tagName: 'BUTTON',
      getAttribute: (name) => (name === 'data-testid' ? 'a"b\\c' : null),
    },
  }), 'button[data-testid="a\\"b\\\\c"]');
  assert.equal(stableLocatorFor({
    el: {
      tagName: 'BUTTON',
      getAttribute: (name) => (name === 'aria-label' ? 'say "hi" \\' : null),
    },
  }), 'button[aria-label="say\\ \\"hi\\"\\ \\\\"]');
});
