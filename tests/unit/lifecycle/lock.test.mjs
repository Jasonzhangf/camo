import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getLockFile,
  getLockInfo,
  acquireLock,
  releaseLock,
  isLocked,
  cleanupStaleLocks,
  listActiveLocks
} from '../../../src/lifecycle/lock.mjs';

const TEST_LOCK_DIR = path.join(os.tmpdir(), 'camo-lock-test-' + Date.now());

describe('lock manager', () => {
  beforeEach(() => {
    // Override lock dir via module internals not possible, test actual behavior
    fs.mkdirSync(TEST_LOCK_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_LOCK_DIR)) {
      fs.rmSync(TEST_LOCK_DIR, { recursive: true, force: true });
    }
  });

  describe('acquireLock', () => {
    it('should create lock file with correct data', () => {
      const lockData = acquireLock('test-profile', { url: 'https://example.com' });
      assert.strictEqual(lockData.profileId, 'test-profile');
      assert.strictEqual(lockData.pid, process.pid);
      assert.strictEqual(lockData.url, 'https://example.com');
      assert.ok(lockData.startTime > 0);
    });

    it('should overwrite existing lock', () => {
      acquireLock('test-profile', { url: 'first' });
      acquireLock('test-profile', { url: 'second' });
      const info = getLockInfo('test-profile');
      assert.strictEqual(info.url, 'second');
    });
  });

  describe('releaseLock', () => {
    it('should remove lock file', () => {
      acquireLock('test-profile');
      assert.strictEqual(isLocked('test-profile'), true);
      const result = releaseLock('test-profile');
      assert.strictEqual(result, true);
      assert.strictEqual(isLocked('test-profile'), false);
    });

    it('should return false for non-existent lock', () => {
      const result = releaseLock('nonexistent-profile');
      assert.strictEqual(result, false);
    });
  });

  describe('isLocked', () => {
    it('should return true for locked profile', () => {
      acquireLock('locked-profile');
      assert.strictEqual(isLocked('locked-profile'), true);
      releaseLock('locked-profile');
    });

    it('should return false for unlocked profile', () => {
      assert.strictEqual(isLocked('never-locked'), false);
    });
  });

  describe('getLockInfo', () => {
    it('should return null for non-existent lock', () => {
      const info = getLockInfo('no-such-profile');
      assert.strictEqual(info, null);
    });

    it('should return null for corrupted lock file', () => {
      acquireLock('corrupt-test');
      const lockFile = getLockFile('corrupt-test');
      fs.writeFileSync(lockFile, 'not valid json');
      const info = getLockInfo('corrupt-test');
      assert.strictEqual(info, null);
      releaseLock('corrupt-test');
    });
  });

  describe('cleanupStaleLocks', () => {
    it('should remove corrupted lock files', () => {
      acquireLock('stale-test');
      const lockFile = getLockFile('stale-test');
      fs.writeFileSync(lockFile, 'invalid');
      const cleaned = cleanupStaleLocks();
      assert.ok(cleaned >= 1);
    });

    it('should remove old locks', () => {
      // Create a lock with old mtime
      acquireLock('old-test');
      const lockFile = getLockFile('old-test');
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      fs.utimesSync(lockFile, oldTime / 1000, oldTime / 1000);
      const cleaned = cleanupStaleLocks();
      assert.ok(cleaned >= 1);
    });
  });

  describe('listActiveLocks', () => {
    it('should list all active locks', () => {
      acquireLock('profile-a');
      acquireLock('profile-b');
      const locks = listActiveLocks();
      const profileIds = locks.map(l => l.profileId);
      assert.ok(profileIds.includes('profile-a'));
      assert.ok(profileIds.includes('profile-b'));
      releaseLock('profile-a');
      releaseLock('profile-b');
    });
  });
});
