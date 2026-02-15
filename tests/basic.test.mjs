import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('camo CLI', () => {
  it('should load without errors', () => {
    // Just verify the module can be imported
    assert.doesNotThrow(() => {
      import('../src/cli.mjs');
    });
  });
});
