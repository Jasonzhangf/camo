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

  describe('constants', () => {
    it('should export required constants', async () => {
      const config = await import('../../../src/utils/config.mjs');
      assert.ok(config.CONFIG_DIR);
      assert.ok(config.PROFILES_DIR);
      assert.ok(config.CONFIG_FILE);
      assert.ok(config.BROWSER_SERVICE_URL);
    });
  });
});
