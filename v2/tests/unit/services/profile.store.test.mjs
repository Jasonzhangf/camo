import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as profile from '../../../services/profile/store.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-profile-store-'));
profile.__enableTestRoot();
profile.__setProfilesRootForTest(tmpRoot);

test('positive: write then read roundtrip', () => {
  const p = profile.write('alpha', { fingerprint: 'fp-1', windowSize: { width: 1280, height: 720 }, headless: true });
  assert.equal(p.profileId, 'alpha');
  assert.equal(p.fingerprint, 'fp-1');
  const r = profile.read('alpha');
  assert.deepEqual(r.windowSize, { width: 1280, height: 720 });
});

test('positive: list returns created profile', () => {
  profile.write('beta', { headless: false });
  const all = profile.list();
  assert.ok(all.includes('alpha'));
  assert.ok(all.includes('beta'));
});

test('positive: write updates updatedAt, preserves createdAt', async () => {
  const a = profile.write('gamma', { headless: false });
  await new Promise((r) => setTimeout(r, 5));
  const b = profile.write('gamma', { headless: true });
  assert.equal(a.createdAt, b.createdAt);
  assert.notEqual(a.updatedAt, b.updatedAt);
});

test('positive: exists returns true for known, false for missing', () => {
  profile.write('delta', {});
  assert.equal(profile.exists('delta'), true);
  assert.equal(profile.exists('nope'), false);
});
