import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('container command', () => {
  describe('module exports', () => {
    it('should export handleContainerCommand', async () => {
      const container = await import('../../../src/commands/container.mjs');
      assert.strictEqual(typeof container.handleContainerCommand, 'function');
    });
  });
});
