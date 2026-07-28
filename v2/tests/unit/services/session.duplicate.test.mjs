import test from 'node:test';
import assert from 'node:assert/strict';
import * as session from '../../../services/session/manager.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

session.__enableTestRoot();

test('negative: create duplicate profileId throws E_STATE_DUPLICATE', () => {
  session.__resetForTest();
  session.create('x', {});
  let err;
  try { session.create('x', {}); } catch (e) { err = e; }
  assert.equal(err instanceof CamoError, true);
  assert.equal(err.code, 'E_STATE_DUPLICATE');
  assert.equal(err.details.profileId, 'x');
});

test('negative: create duplicate alias throws E_STATE_DUPLICATE', () => {
  session.__resetForTest();
  session.create('p1', { alias: 'dup' });
  let err;
  try { session.create('p2', { alias: 'dup' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_STATE_DUPLICATE');
  assert.equal(err.details.alias, 'dup');
});

test('negative: read missing profileId throws E_STATE_NOT_FOUND', () => {
  session.__resetForTest();
  let err;
  try { session.read('nope'); } catch (e) { err = e; }
  assert.equal(err.code, 'E_STATE_NOT_FOUND');
});

test('negative: empty profileId throws E_INPUT_MISSING_FIELD', () => {
  session.__resetForTest();
  let err;
  try { session.create('', {}); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: invalid status throws E_INPUT_OUT_OF_RANGE', () => {
  session.__resetForTest();
  session.create('q', {});
  let err;
  try { session.update('q', { status: 'unkn0wn' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_OUT_OF_RANGE');
});

test('negative: invalid alias chars throw E_INPUT_INVALID', () => {
  session.__resetForTest();
  let err;
  try { session.create('q', { alias: 'has space' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_INVALID');
});

test('negative: delete missing throws E_STATE_NOT_FOUND', () => {
  session.__resetForTest();
  let err;
  try { session.deleteSession('never-was'); } catch (e) { err = e; }
  assert.equal(err.code, 'E_STATE_NOT_FOUND');
});
