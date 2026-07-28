import test from 'node:test';
import assert from 'node:assert/strict';
import { CamoError, project, toWire, knownCodes, getSpec } from '../../../contracts/error_envelope/projector.mjs';

test('positive: E_INPUT_MISSING_FIELD projects to expected wire form', () => {
  const ce = new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  const out = project(ce);
  assert.equal(out.code, 'E_INPUT_MISSING_FIELD');
  assert.equal(typeof out.message, 'string');
  assert.equal(out.details.field, 'profileId');
});

test('positive: toWire strips null details', () => {
  const ce = new CamoError({ code: 'E_STATE_NOT_FOUND' });
  const out = toWire(ce);
  assert.equal('details' in out, false);
  assert.equal(out.code, 'E_STATE_NOT_FOUND');
});

test('positive: known codes registry exposes codes listed in codes.json', () => {
  const codes = knownCodes();
  assert.ok(codes.includes('E_INPUT_MISSING_FIELD'));
  assert.ok(codes.includes('E_STATE_NOT_FOUND'));
  assert.ok(codes.includes('E_PROTO_BAD_VERSION'));
});

test('positive: getSpec returns spec for known code', () => {
  const s = getSpec('E_INPUT_OUT_OF_RANGE');
  assert.equal(s.code, 'E_INPUT_OUT_OF_RANGE');
  assert.ok(s.default_user_message.length > 0);
});
