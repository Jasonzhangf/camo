import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
  detectCamoufoxPath,
  ensureCamoufox,
  getProfileDir,
  ensureProfile,
  isBrowserRunning,
} from '../../src/core/browser.mjs';
import { PROFILES_DIR } from '../../src/utils/config.mjs';

describe('Core Browser Module', () => {
  const testProfile = 'test-core-browser';
  const testProfileDir = path.join(PROFILES_DIR, testProfile);

  afterEach(() => {
    // Cleanup test profile
    try {
      fs.rmSync(testProfileDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('detectCamoufoxPath', () => {
    it('should return null or string', async () => {
      const result = detectCamoufoxPath();
      // Either null (not installed) or a path string
      assert.ok(result === null || typeof result === 'string');
    });
  });

  describe('getProfileDir', () => {
    it('should return a valid path', () => {
      const dir = getProfileDir(testProfile);
      assert.equal(dir, testProfileDir);
      assert.ok(dir.includes(testProfile));
    });
  });

  describe('ensureProfile', () => {
    it('should create profile directory', () => {
      const dir = ensureProfile(testProfile);
      assert.ok(fs.existsSync(dir));
      assert.ok(fs.statSync(dir).isDirectory());
    });

    it('should not throw for existing profile', () => {
      ensureProfile(testProfile);
      // Second call should succeed
      const dir = ensureProfile(testProfile);
      assert.ok(fs.existsSync(dir));
    });
  });

  describe('isBrowserRunning', () => {
    it('should return false for non-existent profile', () => {
      const running = isBrowserRunning('non-existent-profile-12345');
      assert.strictEqual(running, false);
    });
  });
});
