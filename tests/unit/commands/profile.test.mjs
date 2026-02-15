import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('profile command', () => {
  describe('module exports', () => {
    it('should export handleProfileCommand', async () => {
      const profile = await import('../../../src/commands/profile.mjs');
      assert.strictEqual(typeof profile.handleProfileCommand, 'function');
    });
  });
});
