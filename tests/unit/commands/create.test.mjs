import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('create command', () => {
  describe('module exports', () => {
    it('should export required functions', async () => {
      const create = await import('../../../src/commands/create.mjs');
      assert.strictEqual(typeof create.handleCreateCommand, 'function');
      assert.strictEqual(typeof create.listFingerprints, 'function');
      assert.strictEqual(typeof create.getFingerprint, 'function');
    });
  });
});
