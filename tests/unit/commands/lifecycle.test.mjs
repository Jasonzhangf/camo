import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('lifecycle command', () => {
  describe('module exports', () => {
    it('should export required functions', async () => {
      const lifecycle = await import('../../../src/commands/lifecycle.mjs');
      assert.strictEqual(typeof lifecycle.handleCleanupCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleForceStopCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleLockCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleUnlockCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleSessionsCommand, 'function');
    });
  });
});
