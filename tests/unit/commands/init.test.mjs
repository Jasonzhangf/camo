import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('init command', () => {
  describe('module exports', () => {
    it('should export handleInitCommand', async () => {
      const init = await import('../../../src/commands/init.mjs');
      assert.strictEqual(typeof init.handleInitCommand, 'function');
    });
  });
});
