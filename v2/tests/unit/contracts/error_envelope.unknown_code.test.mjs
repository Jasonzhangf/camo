import test from 'node:test';
import assert from 'node:assert/strict';
import { CamoError, project, toWire, getSpec } from '../../../contracts/error_envelope/projector.mjs';

test('negative: getSpec returns null for unknown code', () => {
  assert.equal(getSpec('E_NOPE_NOT_REAL'), null);
});

test('negative: CamoError without code auto-promotes to E_INTERNAL_UNEXPECTED', () => {
  const ce = new CamoError({ details: { x: 1 } });
  assert.equal(ce.code, 'E_INTERNAL_UNEXPECTED');
});

test('negative: project of plain Error classifies as internal', () => {
  const out = project(new Error('boom'));
  assert.equal(out.code, 'E_INTERNAL_UNEXPECTED');
  assert.equal(out.details.name, 'Error');
});

test('negative: toWire of plain error still returns valid envelope', () => {
  const out = toWire(new TypeError('x'));
  assert.equal(out.code, 'E_INTERNAL_UNEXPECTED');
  assert.ok(typeof out.message === 'string');
});

test('negative: CamoError constructed with unknown code still gets a sensible default message', () => {
  const ce = new CamoError({ code: 'E_NOT_REAL' });
  assert.equal(ce.code, 'E_NOT_REAL');
  // message falls back to "Unknown error" because spec missing
  assert.equal(ce.message, 'Unknown error');
});
