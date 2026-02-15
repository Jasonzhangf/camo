import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('CLI module', () => {
  it('should be importable', async () => {
    const cli = await import('../../src/cli.mjs');
    assert.ok(cli);
  });
});
