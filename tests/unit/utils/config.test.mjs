import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('config utilities', () => {
  describe('module exports', () => {
    it('should export required functions', async () => {
      const config = await import('../../../src/utils/config.mjs');
      assert.strictEqual(typeof config.ensureDir, 'function');
      assert.strictEqual(typeof config.readJson, 'function');
      assert.strictEqual(typeof config.writeJson, 'function');
      assert.strictEqual(typeof config.loadConfig, 'function');
      assert.strictEqual(typeof config.saveConfig, 'function');
      assert.strictEqual(typeof config.listProfiles, 'function');
      assert.strictEqual(typeof config.isValidProfileId, 'function');
      assert.strictEqual(typeof config.createProfile, 'function');
      assert.strictEqual(typeof config.deleteProfile, 'function');
      assert.strictEqual(typeof config.setDefaultProfile, 'function');
      assert.strictEqual(typeof config.getDefaultProfile, 'function');
      assert.strictEqual(typeof config.getHighlightMode, 'function');
      assert.strictEqual(typeof config.setHighlightMode, 'function');
      assert.strictEqual(typeof config.getProfileWindowSize, 'function');
      assert.strictEqual(typeof config.setProfileWindowSize, 'function');
      assert.strictEqual(typeof config.getProfileMetaFile, 'function');
      assert.strictEqual(typeof config.resolveWebautoRoot, 'function');
      assert.strictEqual(typeof config.resolveProfilesDir, 'function');
    });
  });

  describe('resolveWebautoRoot', () => {
    it('prefers explicit WEBAUTO_DATA_ROOT without appending .webauto', async () => {
      const { resolveWebautoRoot } = await import('../../../src/utils/config.mjs');
      const resolved = resolveWebautoRoot({
        platform: 'win32',
        hasDDrive: true,
        env: { WEBAUTO_DATA_ROOT: 'D:\\webauto' },
      });
      assert.equal(resolved, path.win32.join('D:', 'webauto'));
    });

    it('prefers explicit WEBAUTO_HOME without appending .webauto', async () => {
      const { resolveWebautoRoot } = await import('../../../src/utils/config.mjs');
      const resolved = resolveWebautoRoot({
        platform: 'win32',
        hasDDrive: true,
        env: { WEBAUTO_HOME: 'D:\\webauto' },
      });
      assert.equal(resolved, path.win32.join('D:', 'webauto'));
    });

    it('uses WEBAUTO_HOME as direct root path', async () => {
      const { resolveWebautoRoot } = await import('../../../src/utils/config.mjs');
      const resolved = resolveWebautoRoot({
        platform: 'darwin',
        env: { WEBAUTO_HOME: '/tmp/custom-webauto-home' },
      });
      assert.equal(resolved, '/tmp/custom-webauto-home');
    });

    it('keeps backward compatibility for parent root input', async () => {
      const { resolveWebautoRoot } = await import('../../../src/utils/config.mjs');
      const resolved = resolveWebautoRoot({
        platform: 'darwin',
        env: { WEBAUTO_ROOT: '/tmp/portable-root' },
      });
      assert.equal(resolved, path.join('/tmp/portable-root', '.webauto'));
    });

    it('defaults to D:\\webauto on windows when D drive exists', async () => {
      const { resolveWebautoRoot } = await import('../../../src/utils/config.mjs');
      const resolved = resolveWebautoRoot({
        platform: 'win32',
        hasDDrive: true,
        env: {},
      });
      assert.equal(resolved, path.win32.join('D:', 'webauto'));
    });

    it('falls back to ~/.webauto on windows when D drive is missing', async () => {
      const { resolveWebautoRoot } = await import('../../../src/utils/config.mjs');
      const home = path.join('C:', 'Users', 'tester');
      const resolved = resolveWebautoRoot({
        platform: 'win32',
        hasDDrive: false,
        homeDir: home,
        env: {},
      });
      assert.equal(resolved, path.win32.join(home, '.webauto'));
    });
  });

  describe('resolveProfilesDir', () => {
    it('uses WEBAUTO_PROFILE_ROOT when provided', async () => {
      const { resolveProfilesDir } = await import('../../../src/utils/config.mjs');
      const resolved = resolveProfilesDir({
        platform: 'win32',
        env: { WEBAUTO_PROFILE_ROOT: 'E:\\profiles' },
      });
      assert.equal(resolved, path.win32.join('E:', 'profiles'));
    });

    it('defaults to <root>/profiles', async () => {
      const { resolveProfilesDir } = await import('../../../src/utils/config.mjs');
      const resolved = resolveProfilesDir({
        platform: 'darwin',
        env: { WEBAUTO_DATA_ROOT: '/tmp/webauto-data' },
      });
      assert.equal(resolved, '/tmp/webauto-data/profiles');
    });
  });

  describe('isValidProfileId', () => {
    it('should accept valid profile IDs', async () => {
      const { isValidProfileId } = await import('../../../src/utils/config.mjs');
      assert.strictEqual(isValidProfileId('profile123'), true);
      assert.strictEqual(isValidProfileId('my_profile'), true);
      assert.strictEqual(isValidProfileId('my-profile'), true);
      assert.strictEqual(isValidProfileId('my.profile'), true);
      assert.strictEqual(isValidProfileId('Profile_123.test'), true);
    });

    it('should reject invalid profile IDs', async () => {
      const { isValidProfileId } = await import('../../../src/utils/config.mjs');
      assert.strictEqual(isValidProfileId('profile/with/slash'), false);
      assert.strictEqual(isValidProfileId('profile:with:colon'), false);
      assert.strictEqual(isValidProfileId(''), false);
      assert.strictEqual(isValidProfileId(null), false);
      assert.strictEqual(isValidProfileId(undefined), false);
      assert.strictEqual(isValidProfileId(123), false);
      assert.strictEqual(isValidProfileId('profile with space'), false);
    });
  });

  describe('ensureDir', () => {
    it('should create nested directories', async () => {
      const { ensureDir } = await import('../../../src/utils/config.mjs');
      const testDir = path.join(os.tmpdir(), 'camo-test-ed-' + Date.now() + '-' + Math.random().toString(36).slice(2,7), 'nested');
      ensureDir(testDir);
      assert.strictEqual(fs.existsSync(testDir), true);
      // Clean up
      const parent = path.dirname(testDir);
      fs.rmSync(parent, { recursive: true, force: true });
    });

    it('should not throw for existing directories', async () => {
      const { ensureDir } = await import('../../../src/utils/config.mjs');
      const testDir = path.join(os.tmpdir(), 'camo-test-ed2-' + Date.now());
      fs.mkdirSync(testDir, { recursive: true });
      assert.doesNotThrow(() => ensureDir(testDir));
      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('readJson/writeJson', () => {
    it('should write and read JSON correctly', async () => {
      const { writeJson, readJson } = await import('../../../src/utils/config.mjs');
      const testFile = path.join(os.tmpdir(), 'camo-test-json-' + Date.now() + '.json');
      const data = { foo: 'bar', num: 42, nested: { a: 1 } };
      writeJson(testFile, data);
      const read = readJson(testFile);
      assert.deepStrictEqual(read, data);
      fs.unlinkSync(testFile);
    });

    it('should return null for non-existent file', async () => {
      const { readJson } = await import('../../../src/utils/config.mjs');
      const result = readJson('/nonexistent/path/file.json');
      assert.strictEqual(result, null);
    });

    it('should return null for invalid JSON', async () => {
      const { readJson } = await import('../../../src/utils/config.mjs');
      const testFile = path.join(os.tmpdir(), 'camo-test-inv-' + Date.now() + '.json');
      fs.writeFileSync(testFile, 'not valid json {');
      const result = readJson(testFile);
      assert.strictEqual(result, null);
      fs.unlinkSync(testFile);
    });
  });

  describe('listProfiles', () => {
    it('should return an array', async () => {
      const { listProfiles } = await import('../../../src/utils/config.mjs');
      const profiles = listProfiles();
      assert.ok(Array.isArray(profiles));
    });
  });

  describe('loadConfig/saveConfig', () => {
    it('should load config with defaults', async () => {
      const { loadConfig } = await import('../../../src/utils/config.mjs');
      const cfg = loadConfig();
      assert.ok(cfg !== null);
      assert.ok('defaultProfile' in cfg);
      assert.ok('repoRoot' in cfg);
      assert.ok('highlightMode' in cfg);
    });
  });

  describe('highlight mode config', () => {
    it('should set and get highlight mode', async () => {
      const { getHighlightMode, setHighlightMode } = await import('../../../src/utils/config.mjs');
      setHighlightMode(false);
      assert.strictEqual(getHighlightMode(), false);
      setHighlightMode(true);
      assert.strictEqual(getHighlightMode(), true);
    });
  });

  describe('createProfile/deleteProfile', () => {
    it('should create and delete profile', async () => {
      const { createProfile, deleteProfile, listProfiles } = await import('../../../src/utils/config.mjs');
      const profileId = 'test-prof-' + Date.now();
      
      createProfile(profileId);
      const profilesAfterCreate = listProfiles();
      assert.ok(profilesAfterCreate.includes(profileId));
      
      deleteProfile(profileId);
      const profilesAfterDelete = listProfiles();
      assert.ok(!profilesAfterDelete.includes(profileId));
    });

    it('should throw for invalid profile ID on create', async () => {
      const { createProfile } = await import('../../../src/utils/config.mjs');
      assert.throws(() => createProfile('invalid/id'), /Invalid profileId/);
    });

    it('should throw for non-existent profile on delete', async () => {
      const { deleteProfile } = await import('../../../src/utils/config.mjs');
      assert.throws(() => deleteProfile('non-existent-prof-' + Date.now()), /Profile not found/);
    });
  });

  describe('setDefaultProfile/getDefaultProfile', () => {
    it('should set and get default profile', async () => {
      const { createProfile, setDefaultProfile, getDefaultProfile, deleteProfile } = await import('../../../src/utils/config.mjs');
      const profileId = 'test-def-' + Date.now();
      
      createProfile(profileId);
      setDefaultProfile(profileId);
      const def = getDefaultProfile();
      assert.strictEqual(def, profileId);
      
      setDefaultProfile(null);
      
      deleteProfile(profileId);
    });
  });

  describe('profile window persistence', () => {
    it('should persist and read window size from profile meta', async () => {
      const {
        createProfile,
        deleteProfile,
        setProfileWindowSize,
        getProfileWindowSize,
        getProfileMetaFile,
      } = await import('../../../src/utils/config.mjs');
      const profileId = 'test-window-' + Date.now();

      createProfile(profileId);
      setProfileWindowSize(profileId, 1918, 1024);
      const saved = getProfileWindowSize(profileId);
      assert.ok(saved);
      assert.strictEqual(saved.width, 1918);
      assert.strictEqual(saved.height, 1024);
      assert.ok(Number(saved.updatedAt) > 0);
      assert.strictEqual(fs.existsSync(getProfileMetaFile(profileId)), true);

      deleteProfile(profileId);
    });

    it('should return null for invalid saved sizes', async () => {
      const { setProfileWindowSize } = await import('../../../src/utils/config.mjs');
      const result = setProfileWindowSize('invalid/id', 1000, 800);
      assert.strictEqual(result, null);
    });
  });

  describe('constants', () => {
    it('should export required constants', async () => {
      const config = await import('../../../src/utils/config.mjs');
      assert.ok(config.CONFIG_DIR);
      assert.ok(config.PROFILES_DIR);
      assert.ok(config.CONFIG_FILE);
      assert.ok(config.PROFILE_META_FILE);
      assert.ok(config.BROWSER_SERVICE_URL);
    });
  });
});
