import test from 'node:test';
import assert from 'node:assert/strict';
import * as matcher from '../../../services/container/matcher.mjs';

test('positive: matches visible-in-viewport query and ranks exact text first', () => {
  const snap = [
    { id: 'a', role: 'button', text: 'Submit', visible: true, viewport: { width: 1280, height: 720 }, x: 10, y: 10, width: 80, height: 24 },
    { id: 'b', role: 'button', text: 'Submit again', visible: true, viewport: { width: 1280, height: 720 }, x: 10, y: 40, width: 80, height: 24 },
    { id: 'c', role: 'button', text: 'Cancel',     visible: true, viewport: { width: 1280, height: 720 }, x: 10, y: 70, width: 80, height: 24 },
  ];
  const out = matcher.match({ role: 'button', text: 'Submit' }, snap);
  assert.equal(out.matched.length, 2);
  assert.equal(out.primary.id, 'a'); // exact text wins over "Submit again"
});

test('positive: inspect returns matchedCount and visibleTotal', () => {
  const snap = [
    { id: 'a', role: 'button', text: 'Go', visible: true, viewport: { width: 100, height: 100 }, x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', role: 'button', text: 'Go', visible: false },
    { id: 'c', role: 'button', text: 'Go', visible: true, viewport: { width: 100, height: 100 }, x: 200, y: 0, width: 10, height: 10 }, // out of viewport
  ];
  const out = matcher.inspect({ role: 'button', text: 'Go' }, snap);
  assert.equal(out.matchedCount, 1);
  assert.equal(out.visibleTotal, 1);
});

test('positive: visibleCount ignores hidden and out-of-viewport', () => {
  const snap = [
    { id: 'x', visible: true, viewport: { width: 100, height: 100 }, x: 0, y: 0, width: 10, height: 10 },
    { id: 'y', visible: false },
    { id: 'z' }, // visible defaults true
  ];
  // no viewport on z -> inViewport=true (defaults)
  assert.equal(matcher.visibleCount(snap), 2);
});

test('negative: empty query throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { matcher.match({}, [{ id: 'a' }]); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: invalid role throws E_INPUT_OUT_OF_RANGE', () => {
  let err;
  try { matcher.match({ role: 'not-a-role' }, [{ id: 'a', role: 'button' }]); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_OUT_OF_RANGE');
  assert.equal(err?.details?.field, 'role');
});

test('negative: non-array snapshot throws E_INPUT_INVALID', () => {
  let err;
  try { matcher.match({ id: 'a' }, { id: 'a' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_INVALID');
});

test('positive: semantic snapshot nodes normalize role/name/ref for matcher queries', () => {
  const snap = [
    { ref: 'ref:snap:n1', role: 'checkbox', nameText: 'Remember me', stableLocator: 'input[aria-label="Remember me"]', visible: true, inViewport: true },
  ];
  const out = matcher.match({ role: 'checkbox', text: 'Remember' }, snap);
  assert.equal(out.matched.length, 1);
  assert.equal(out.primary.id, 'ref:snap:n1');
  assert.equal(out.primary.ref, 'ref:snap:n1');
  assert.equal(out.primary.stableLocator, 'input[aria-label="Remember me"]');
  assert.equal(out.primary.nameText, 'Remember me');
});
