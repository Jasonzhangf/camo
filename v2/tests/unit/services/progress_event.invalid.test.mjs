import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as log from '../../../services/progress_event/log.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

log.__enableTestRoot();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-evt-invalid-'));
log.__setRunsRootForTest(tmpRoot);

test('negative: missing runId throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { log.append({ event: 'ev', source: 's' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_MISSING_FIELD');
  assert.equal(err.details.field, 'runId');
});

test('negative: invalid runId characters throw E_INPUT_INVALID', () => {
  let err;
  try { log.append({ runId: 'has space', event: 'ev', source: 's' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_INVALID');
});

test('negative: missing event throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { log.append({ runId: 'rbad', source: 's' }); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: readRecent with unknown runId throws E_INPUT_MISSING_FIELD (because build path requires runId)', () => {
  let err;
  try { log.readRecent(''); } catch (e) { err = e; }
  assert.equal(err.code, 'E_INPUT_MISSING_FIELD');
});
