import test from 'node:test';
import assert from 'node:assert/strict';
import * as click from '../../../services/autoscript/actions/click.mjs';
import * as type from '../../../services/autoscript/actions/type.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

test('positive: click returns ok with primary container', () => {
  const ctx = {
    profileId: 'p',
    match: (q, snap) => ({ primary: snap[0] }),
    snapshot: () => [{ id: 'btn-1', role: 'button', text: 'OK', visible: true, inViewport: true }],
  };
  const out = click.run({ params: { id: 'btn-1' }, ctx });
  assert.equal(out.ok, true);
  assert.equal(out.containerId, 'btn-1');
  assert.equal(out.kind, 'click');
});

test('positive: click without match returns ok:false with E_STATE_NOT_FOUND code', () => {
  const ctx = {
    profileId: 'p',
    match: () => ({ primary: null }),
    snapshot: () => [],
  };
  const out = click.run({ params: { id: 'missing' }, ctx });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'E_STATE_NOT_FOUND');
});

test('positive: type returns text and target container when found', () => {
  const ctx = {
    profileId: 'p',
    match: (q, snap) => ({ primary: snap[0] }),
    snapshot: () => [{ id: 'inp-1', role: 'textbox', text: '', visible: true, inViewport: true }],
  };
  const out = type.run({ params: { text: 'hello', into: { role: 'textbox' } }, ctx });
  assert.equal(out.ok, true);
  assert.equal(out.text, 'hello');
  assert.equal(out.containerId, 'inp-1');
});

test('negative: click without query throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { click.run({ params: {}, ctx: { match: () => ({ primary: null }), snapshot: () => [] } }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: click without ctx throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { click.run({ params: { id: 'x' }, ctx: null }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
  assert.equal(err?.details?.field, 'ctx');
});

test('negative: type without text throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { type.run({ params: { text: '' }, ctx: { match: () => ({ primary: null }), snapshot: () => [] } }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
  assert.equal(err?.details?.field, 'text');
});

test('negative: type with non-object into throws E_INPUT_INVALID', () => {
  let err;
  try { type.run({ params: { text: 'x', into: 'nope' }, ctx: { match: () => ({ primary: null }), snapshot: () => [] } }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_INVALID');
});

test('schema: click and type expose schema.actionId', () => {
  assert.equal(click.schema.actionId, 'click');
  assert.equal(type.schema.actionId, 'type');
});
