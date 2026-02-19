import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildSelectorClickScript,
  buildSelectorTypeScript,
  buildSelectorScrollIntoViewScript,
  buildScrollTargetScript,
} from '../../../src/container/runtime-core/operations/selector-scripts.mjs';

describe('selector scripts', () => {
  it('builds click script with visible resolver and highlight=true', () => {
    const script = buildSelectorClickScript({ selector: '.item', highlight: true });
    assert.ok(script.includes('document.querySelectorAll(selector)'));
    assert.ok(script.includes("action: 'click'"));
    assert.ok(script.includes('highlight: true'));
  });

  it('builds type script with typeable guard and highlight=false', () => {
    const script = buildSelectorTypeScript({ selector: '#input', highlight: false, text: 'hello' });
    assert.ok(script.includes('isTypeable'));
    assert.ok(script.includes("action: 'type'"));
    assert.ok(script.includes('highlight: false'));
  });

  it('builds type script with empty text fallback branch', () => {
    const script = buildSelectorTypeScript({ selector: '#input', highlight: true });
    assert.ok(script.includes("length: 0"));
    assert.ok(script.includes('highlight: true'));
  });

  it('builds scroll-into-view script with target metadata', () => {
    const script = buildSelectorScrollIntoViewScript({ selector: '#list', highlight: true });
    assert.ok(script.includes('scrollIntoView'));
    assert.ok(script.includes("action: 'scrollIntoView'"));
    assert.ok(script.includes('matchedIndex'));
  });

  it('builds scroll target resolver script with selector and fallback', () => {
    const scriptWithSelector = buildScrollTargetScript({ selector: '.feed', highlight: true });
    const scriptNoSelector = buildScrollTargetScript({ selector: '', highlight: false });
    assert.ok(scriptWithSelector.includes('document.querySelectorAll(selector)'));
    assert.ok(scriptWithSelector.includes('source = \'selector\''));
    assert.ok(scriptNoSelector.includes('source = \'document\''));
    assert.ok(scriptNoSelector.includes('highlight: false'));
  });
});
