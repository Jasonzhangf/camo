import test from 'node:test';
import assert from 'node:assert/strict';
import * as clog from '../../../services/command_log/log.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

test('negative: append outside test mode without writer:"cli" throws E_INTERNAL_UNEXPECTED', () => {
  // __enableTestRoot was NOT called.
  let err;
  try {
    clog.append({
      runId: 'r', cmd: 'x', source: 'cli', args: [], writer: 'someone',
    });
  } catch (e) { err = e; }
  assert.equal(err instanceof CamoError, true);
  assert.equal(err.code, 'E_INTERNAL_UNEXPECTED');
});

test('negative: missing runId throws E_INPUT_MISSING_FIELD', () => {
  clog.__enableTestRoot();
  let err;
  try { clog.append({ cmd: 'x', source: 'cli', args: [] }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: invalid runId characters throw E_INPUT_INVALID', () => {
  let err;
  try { clog.append({ runId: 'has space', cmd: 'x', source: 'cli', args: [] }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_INVALID');
});

test('negative: missing cmd throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { clog.append({ runId: 'r', source: 'cli', args: [] }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});
