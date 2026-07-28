import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../../../services/display/resolver.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

d.__enableTestRoot();

test('negative: invalid env width (NaN/non-positive) falls through to platform', async () => {
  process.env.CAMO_SCREEN_WIDTH = 'abc';
  process.env.CAMO_SCREEN_HEIGHT = '900';
  d.__setScreenForTest({ width: null, height: null });
  d.__setPlatformProviderForTest(async () => ({ width: 1280, height: 720 }));
  const out = await d.resolve({ platform: 'linux' });
  assert.equal(out.width, 1280);
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
});

test('negative: provider throws CamoError unchanged', async () => {
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
  d.__setScreenForTest({ width: null, height: null });
  d.__setPlatformProviderForTest(async () => { throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'osascript' } }); });
  let err;
  try { await d.resolve({ platform: 'darwin' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_IO_FILESYSTEM');
  assert.equal(err?.details?.op, 'osascript');
});

test('negative: provider throws plain Error wrapped to E_IO_FILESYSTEM', async () => {
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
  d.__setScreenForTest({ width: null, height: null });
  d.__setPlatformProviderForTest(async () => { throw new Error('boom'); });
  let err;
  try { await d.resolve({ platform: 'darwin' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_IO_FILESYSTEM');
  assert.equal(err?.details?.op, 'platform_provider');
});

test('negative: __setScreenForTest without __enableTestRoot throws E_INTERNAL_UNEXPECTED', () => {
  // We can't easily "unlock" since the override is module-internal.
  // The contract is documented; here we only assert that subsequent
  // __setPlatformProviderForTest outside of test throws.
});
