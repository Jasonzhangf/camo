import test from 'node:test';
import assert from 'node:assert/strict';
import * as tabs from '../../../services/page_runtime/tab_pool.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

tabs.__enableTestRoot();

test('positive: next() returns active current slot, advances on each call', () => {
  tabs.__resetForTest();
  const first = tabs.next('p1');
  const second = tabs.next('p1');
  const third = tabs.next('p1');
  assert.equal(first.status, 'active');
  assert.equal(first.slotId, 'tab-0');
  assert.equal(second.slotId, 'tab-0'); // only one slot
  assert.equal(third.slotId, 'tab-0');
  assert.equal(tabs.current('p1').slotId, 'tab-0');
});

test('positive: ensureSlot and setSlot create and update a slot', () => {
  tabs.__resetForTest();
  const a = tabs.ensureSlot('p2', 'tab-x');
  const b = tabs.ensureSlot('p2', 'tab-x');
  assert.equal(a, b);
  const updated = tabs.setSlot('p2', 'tab-x', { status: 'active' });
  assert.equal(updated.status, 'active');
  assert.equal(tabs.list('p2').length, 1);
});

test('positive: closeAll zeroes current and marks closed', () => {
  tabs.__resetForTest();
  tabs.next('p3');
  const n = tabs.closeAll('p3');
  assert.equal(n, 1);
  assert.equal(tabs.current('p3'), null);
  assert.equal(tabs.list('p3')[0].status, 'closed');
});

test('negative: invalid status on setSlot throws E_INPUT_OUT_OF_RANGE', () => {
  let err;
  try { tabs.setSlot('p4', 'tab-bad', { status: 'frozen' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_OUT_OF_RANGE');
  assert.equal(err?.details?.field, 'status');
});

test('negative: empty profileId throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { tabs.list(''); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: illegal slotId characters throw E_INPUT_INVALID', () => {
  let err;
  try { tabs.ensureSlot('p5', 'has space'); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_INVALID');
});
