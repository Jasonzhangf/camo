import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../../../services/display/resolver.mjs';

d.__enableTestRoot();

test('positive: env override returns env source', async () => {
  process.env.CAMO_SCREEN_WIDTH = '1440';
  process.env.CAMO_SCREEN_HEIGHT = '900';
  const out = await d.resolve({ platform: 'darwin' });
  assert.equal(out.width, 1440);
  assert.equal(out.height, 900);
  assert.equal(out.source, 'env');
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
});

test('positive: platform provider result passes through with work dims', async () => {
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
  d.__setScreenForTest({ width: 1920, height: 1080 });
  d.__setPlatformProviderForTest(async () => null);   // override > env
  const out = await d.resolve({ platform: 'linux' });
  assert.equal(out.source, 'test');
  assert.equal(out.width, 1920);
});

test('positive: platform provider value wins when no env or override', async () => {
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
  d.__setScreenForTest({ width: null, height: null });   // disable override
  d.__setPlatformProviderForTest(async () => ({ width: 2560, height: 1440, source: 'darwin', workWidth: 2400, workHeight: 1400 }));
  const out = await d.resolve({ platform: 'darwin' });
  assert.equal(out.width, 2560);
  assert.equal(out.height, 1440);
  assert.equal(out.source, 'darwin');
  assert.equal(out.workWidth, 2400);
  assert.equal(out.workHeight, 1400);
});

test('positive: invalid provider output returns null (not crash)', async () => {
  delete process.env.CAMO_SCREEN_WIDTH;
  delete process.env.CAMO_SCREEN_HEIGHT;
  d.__setScreenForTest({ width: null, height: null });
  d.__setPlatformProviderForTest(async () => ({ width: 0, height: 0 }));
  const out = await d.resolve();
  assert.equal(out, null);
});
