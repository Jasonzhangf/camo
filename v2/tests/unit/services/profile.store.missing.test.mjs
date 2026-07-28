import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as profile from '../../../services/profile/store.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-profile-missing-'));
profile.__enableTestRoot();
profile.__setProfilesRootForTest(tmpRoot);

test('negative: read missing throws CamoError with E_STATE_NOT_FOUND', () => {
  let err;
  try { profile.read('ghost'); } catch (e) { err = e; }
  assert.ok(err instanceof CamoError, 'expected CamoError');
  assert.equal(err.code, 'E_STATE_NOT_FOUND');
  assert.equal(err.details.resource, 'profile');
});

test('negative: empty profileId throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { profile.read(''); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: illegal profileId characters throw E_INPUT_INVALID', () => {
  let err;
  try { profile.write('bad/name', {}); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_INVALID');
});

test('negative: delete nonexistent throws E_STATE_NOT_FOUND', () => {
  let err;
  try { profile.deleteProfile('nope-no-such'); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_STATE_NOT_FOUND');
});
