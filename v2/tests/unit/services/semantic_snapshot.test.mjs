import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureSemanticSnapshot } from '../../../services/page_runtime/semantic_snapshot.mjs';
import * as progress from '../../../services/progress_event/log.mjs';
import * as registry from '../../../services/page_runtime/snapshot_registry.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-semantic-probe-'));
progress.__enableTestRoot();
progress.__setRunsRootForTest(root);
test.after(() => { registry.__resetForTest(); fs.rmSync(root, { recursive: true }); });

function pageFor(context) {
  return {
    evaluate: fn => vm.runInNewContext(`(${fn.toString()})()`, context),
    url: () => 'about:blank',
    content: () => { throw new Error('raw HTML must not be requested'); },
    screenshot: () => { throw new Error('screenshot must not be requested'); },
  };
}
function capture(page, rawDom = false) {
  return captureSemanticSnapshot({ profileId: 'semantic-test', rawDom,
    target: { page, targetId: 'target-test', documentId: 'doc-test', status: 'active' } });
}

test('evaluate alone is not a semantic capability', async () => {
  for (const page of [pageFor({}), { ...pageFor({}), evaluate: undefined },
    { ...pageFor({}), evaluate: () => ({ nodes: [] }) }]) {
    await assert.rejects(capture(page), error => error.code === 'E_SNAPSHOT_CAPABILITY_MISSING');
  }
});

test('available DOM+ARIA semantics are explicitly distinguished from native a11y', async () => {
  const element = { tagName: 'BUTTON', id: 'ok', textContent: 'OK',
    getAttribute: name => name === 'aria-label' ? 'Confirm' : null,
    getBoundingClientRect: () => ({ x: 1, y: 2, width: 20, height: 10, left: 1, top: 2, right: 21, bottom: 12 }) };
  const page = pageFor({
    document: { title: 'Test', getElementById: () => null,
      documentElement: { ...element, querySelectorAll: () => [element] } },
    window: { innerWidth: 100, innerHeight: 100, location: { href: 'about:blank' } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  });
  const result = await capture(page);
  assert.equal(result.capabilities.semantic, 'dom-aria');
  assert.equal(result.capabilities.nativeAccessibility, false);
  assert.equal(result.tree.nodes[0].role, 'button');
  assert.equal(result.tree.nodes[0].name, 'Confirm');
  assert.equal(result.tree.nodes[0].inViewport, true);
});

test('aria-labelledby resolves each whitespace-separated label id', async () => {
  const labelA = { textContent: 'First label' };
  const labelB = { textContent: 'Second label' };
  const element = {
    tagName: 'BUTTON',
    id: 'labelled-button',
    textContent: '',
    getAttribute: name => name === 'aria-labelledby' ? 'label-a label-b' : null,
    getBoundingClientRect: () => ({ x: 3, y: 4, width: 30, height: 12, left: 3, top: 4, right: 33, bottom: 16 }),
  };
  const page = pageFor({
    document: {
      title: 'Labels',
      getElementById: (id) => (id === 'label-a' ? labelA : id === 'label-b' ? labelB : null),
      documentElement: { ...element, querySelectorAll: () => [element] },
    },
    window: { innerWidth: 100, innerHeight: 100, location: { href: 'about:blank' } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  });
  const result = await capture(page);
  assert.equal(result.tree.nodes[0].name, 'First label Second label');
  assert.equal(result.tree.nodes[0].id, 'labelled-button');
  assert.equal(result.tree.nodes[0].stableLocator, '#labelled-button');
});

test('stableLocator escapes CSS metacharacters in DOM ids', async () => {
  const element = {
    tagName: 'BUTTON',
    id: '1.a:b[c] d',
    textContent: 'Go',
    getAttribute: () => null,
    getBoundingClientRect: () => ({ x: 5, y: 6, width: 20, height: 10, left: 5, top: 6, right: 25, bottom: 16 }),
  };
  const page = pageFor({
    document: {
      title: 'Escaped ids',
      getElementById: () => null,
      documentElement: { ...element, querySelectorAll: () => [element] },
    },
    window: { innerWidth: 100, innerHeight: 100, location: { href: 'about:blank' } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  });
  const result = await capture(page);
  assert.equal(result.tree.nodes[0].stableLocator, '#\\31 \\.a\\:b\\[c\\]\\ d');
});

test('stableLocator escapes data-testid and aria-label attribute values', async () => {
  const byTestId = {
    tagName: 'BUTTON',
    textContent: 'By test id',
    getAttribute: (name) => (name === 'data-testid' ? 'a"b\\c' : null),
    getBoundingClientRect: () => ({ x: 7, y: 8, width: 20, height: 10, left: 7, top: 8, right: 27, bottom: 18 }),
  };
  const byAriaLabel = {
    tagName: 'BUTTON',
    textContent: 'By aria label',
    getAttribute: (name) => (name === 'aria-label' ? 'say "hi" \\' : null),
    getBoundingClientRect: () => ({ x: 9, y: 10, width: 20, height: 10, left: 9, top: 10, right: 29, bottom: 20 }),
  };
  const base = {
    document: {
      title: 'Escaped attributes',
      getElementById: () => null,
      documentElement: { querySelectorAll: () => [] },
    },
    window: { innerWidth: 100, innerHeight: 100, location: { href: 'about:blank' } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  const testIdResult = await capture(pageFor({
    ...base,
    document: { ...base.document, documentElement: { ...base.document.documentElement, ...byTestId, querySelectorAll: () => [byTestId] } },
  }));
  assert.equal(testIdResult.tree.nodes[0].stableLocator, 'button[data-testid="a\\"b\\\\c"]');
  const ariaLabelResult = await capture(pageFor({
    ...base,
    document: { ...base.document, documentElement: { ...base.document.documentElement, ...byAriaLabel, querySelectorAll: () => [byAriaLabel] } },
  }));
  assert.equal(ariaLabelResult.tree.nodes[0].stableLocator, 'button[aria-label="say\\ \\"hi\\"\\ \\\\"]');
});

test('explicit raw DOM capture does not require semantic APIs', async () => {
  const result = await capture({ url: () => 'about:blank', content: async () => '<html></html>' }, true);
  assert.equal(result.rawDom, true);
  assert.equal(result.html, '<html></html>');
});
