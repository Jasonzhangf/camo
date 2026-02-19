import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('help utilities', () => {
  describe('module exports', () => {
    it('should export required functions', async () => {
      const help = await import('../../../src/utils/help.mjs');
      assert.strictEqual(typeof help.printHelp, 'function');
      assert.strictEqual(typeof help.printProfilesAndHint, 'function');
    });
  });

  describe('printHelp', () => {
    it('should print help without throwing', async () => {
      const { printHelp } = await import('../../../src/utils/help.mjs');
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));
      
      printHelp();
      
      console.log = originalLog;
      assert.ok(logs.length > 0);
      assert.ok(logs.some(l => l.includes('camo') || l.includes('Usage')));
      assert.ok(logs.some(l => l.includes('--devtools')));
    });
  });

  describe('printProfilesAndHint', () => {
    it('should print profiles hint', async () => {
      const { printProfilesAndHint } = await import('../../../src/utils/help.mjs');
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));
      
      printProfilesAndHint(
        () => ['profile-a', 'profile-b'],
        () => 'profile-a'
      );
      
      console.log = originalLog;
      assert.ok(logs.length > 0);
    });
  });
});
