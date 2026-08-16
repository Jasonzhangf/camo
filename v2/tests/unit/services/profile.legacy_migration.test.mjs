// Legacy profile-state migration tests.
// One-time, fail-fast migration of legacy fingerprint + cookies into the
// profile-owned storage roots owned by v2/services/profile/storage_paths.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateLegacyProfileData,
  resolveProfileDir,
  resolveFingerprintPath,
} from '../../../services/profile/storage_paths.mjs';

function withTempHome(fn) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-migrate-'));
  const previousHome = process.env.HOME;
  const previousProfiles = process.env.CAMO_PATHS_PROFILES;
  const previousProfileRoot = process.env.CAMO_PROFILE_ROOT;
  process.env.HOME = tmpHome;
  delete process.env.CAMO_PATHS_PROFILES;
  delete process.env.CAMO_PROFILE_ROOT;
  return (async () => {
    try { await fn(); }
    finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousProfiles === undefined) delete process.env.CAMO_PATHS_PROFILES;
      else process.env.CAMO_PATHS_PROFILES = previousProfiles;
      if (previousProfileRoot === undefined) delete process.env.CAMO_PROFILE_ROOT;
      else process.env.CAMO_PROFILE_ROOT = previousProfileRoot;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  })();
}

test('positive: profile fingerprint moves from legacy root into profile dir and legacy file is removed', async () => {
  await withTempHome(async () => {
    const pid = 'migrate-fp';
    const legacyDir = path.join(process.env.HOME, '.camo', 'fingerprints');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, `${pid}.json`);
    const legacyData = { profileId: pid, fingerprintSalt: 'legacy-salt', source: 'legacy' };
    fs.writeFileSync(legacyFile, JSON.stringify(legacyData), 'utf8');

    const summary = await migrateLegacyProfileData(pid);
    assert.equal(summary.migrated, true);
    assert.equal(summary.target, resolveFingerprintPath(pid));
    assert.equal(summary.legacy, legacyFile);
    const moved = JSON.parse(fs.readFileSync(resolveFingerprintPath(pid), 'utf8'));
    assert.deepEqual(moved, legacyData);
    assert.equal(fs.existsSync(legacyFile), false, 'legacy fingerprint must be removed');
  });
});

test('positive: profile cookies move from legacy per-profile dir to profile-owned backups', async () => {
  await withTempHome(async () => {
    const pid = 'migrate-cookies';
    const legacyProfileDir = path.join(process.env.HOME, '.camo', 'cookies', pid);
    fs.mkdirSync(legacyProfileDir, { recursive: true });
    const legacyFile = path.join(legacyProfileDir, 'example.com.txt');
    fs.writeFileSync(legacyFile, '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t1786026438\tlegacy\tyes\n', 'utf8');
    fs.writeFileSync(path.join(legacyProfileDir, '.lastVisit.json'), '{"example.com":1786026438}', 'utf8');
    fs.writeFileSync(path.join(legacyProfileDir, 'browser.example.json'), '[{"name":"legacy"}]', 'utf8');

    const summary = await migrateLegacyProfileData(pid);
    assert.equal(summary.migrated, true);
    const targetDir = path.join(resolveProfileDir(pid), 'cookie-backups');
    assert.equal(fs.existsSync(path.join(targetDir, 'example.com.txt')), true);
    assert.equal(fs.existsSync(path.join(targetDir, '.lastVisit.json')), true, 'visit metadata must migrate with cookie files');
    assert.equal(
      fs.existsSync(path.join(resolveProfileDir(pid), 'browser.example.json')),
      true,
      'legacy BrowserInstance JSON must remain readable from the profile root',
    );
    assert.equal(fs.existsSync(legacyFile), false, 'legacy cookie file must be removed');
    assert.equal(fs.existsSync(legacyProfileDir), false, 'empty legacy profile dir must be cleaned');
  });
});

test('negative: target already populated fails fast with typed error and does not overwrite', async () => {
  await withTempHome(async () => {
    const pid = 'migrate-conflict';
    const legacyDir = path.join(process.env.HOME, '.camo', 'fingerprints');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, `${pid}.json`);
    fs.writeFileSync(legacyFile, JSON.stringify({ profileId: pid, source: 'legacy' }), 'utf8');
    const profileDir = resolveProfileDir(pid);
    fs.mkdirSync(profileDir, { recursive: true });
    const targetFile = resolveFingerprintPath(pid);
    fs.writeFileSync(targetFile, JSON.stringify({ profileId: pid, source: 'current' }), 'utf8');

    let err;
    try { await migrateLegacyProfileData(pid); } catch (e) { err = e; }
    assert.ok(err, 'migration must throw when target already populated');
    assert.equal(err.code, 'E_STATE_DUPLICATE');
    assert.equal(err.details?.resource, 'profile_fingerprint');
    assert.deepEqual(JSON.parse(fs.readFileSync(targetFile, 'utf8')), { profileId: pid, source: 'current' }, 'target must be untouched');
    assert.equal(fs.existsSync(legacyFile), true, 'legacy must stay put until conflict is resolved by hand');
  });
});

test('negative: no legacy state is a no-op and never touches target files', async () => {
  await withTempHome(async () => {
    const pid = 'migrate-empty';
    const profileDir = resolveProfileDir(pid);
    fs.mkdirSync(profileDir, { recursive: true });
    const targetFile = resolveFingerprintPath(pid);
    fs.writeFileSync(targetFile, JSON.stringify({ profileId: pid, source: 'current' }), 'utf8');

    const summary = await migrateLegacyProfileData(pid);
    assert.equal(summary.migrated, false);
    assert.deepEqual(summary.legacyPaths, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(targetFile, 'utf8')), { profileId: pid, source: 'current' }, 'target must be untouched');
  });
});

test('negative: cookie target conflict aborts before any legacy file moves', async () => {
  await withTempHome(async () => {
    const pid = 'migrate-cookie-conflict';
    const legacyProfileDir = path.join(process.env.HOME, '.camo', 'cookies', pid);
    fs.mkdirSync(legacyProfileDir, { recursive: true });
    fs.writeFileSync(path.join(legacyProfileDir, 'a.example.txt'), 'legacy-a', 'utf8');
    fs.writeFileSync(path.join(legacyProfileDir, 'b.example.txt'), 'legacy-b', 'utf8');

    const targetDir = path.join(resolveProfileDir(pid), 'cookie-backups');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'b.example.txt'), 'current-b', 'utf8');

    let err;
    try { await migrateLegacyProfileData(pid); } catch (e) { err = e; }
    assert.equal(err?.code, 'E_STATE_DUPLICATE');
    assert.equal(err?.details?.resource, 'profile_cookie_backup');
    assert.equal(fs.readFileSync(path.join(legacyProfileDir, 'a.example.txt'), 'utf8'), 'legacy-a');
    assert.equal(fs.readFileSync(path.join(legacyProfileDir, 'b.example.txt'), 'utf8'), 'legacy-b');
    assert.equal(fs.readFileSync(path.join(targetDir, 'b.example.txt'), 'utf8'), 'current-b');
    assert.equal(fs.existsSync(path.join(targetDir, 'a.example.txt')), false, 'preflight conflict must prevent partial migration');
  });
});

test('positive: migration target honors the documented CAMO_PROFILE_ROOT', async () => {
  await withTempHome(async () => {
    const pid = 'migrate-custom-root';
    const customRoot = path.join(process.env.HOME, 'custom-profiles');
    process.env.CAMO_PROFILE_ROOT = customRoot;
    const legacyDir = path.join(process.env.HOME, '.camo', 'fingerprints');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, `${pid}.json`), '{"source":"legacy"}', 'utf8');

    migrateLegacyProfileData(pid);

    assert.equal(resolveProfileDir(pid), path.join(customRoot, pid));
    assert.equal(fs.existsSync(path.join(customRoot, pid, 'fingerprint.json')), true);
  });
});

test('negative: conflicting profile-root variables fail closed', async () => {
  await withTempHome(async () => {
    process.env.CAMO_PROFILE_ROOT = path.join(process.env.HOME, 'profiles-a');
    process.env.CAMO_PATHS_PROFILES = path.join(process.env.HOME, 'profiles-b');

    assert.throws(
      () => resolveProfileDir('conflicting-roots'),
      (error) => error?.code === 'E_STATE_INVALID' && error?.details?.resource === 'profile_root',
    );
  });
});
