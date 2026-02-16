import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  waitFor,
  retry,
  withTimeout,
  ensureUrlScheme,
  looksLikeUrlToken,
  getPositionals,
} from '../../src/core/utils.mjs';

describe('Core Utils Module', () => {
  describe('waitFor', () => {
    it('should resolve after specified ms', async () => {
      const start = Date.now();
      await waitFor(50);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
    });

    it('should resolve immediately for 0ms', async () => {
      const start = Date.now();
      await waitFor(0);
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 50);
    });
  });

  describe('retry', () => {
    it('should succeed on first attempt', async () => {
      let attempts = 0;
      const result = await retry(async () => {
        attempts++;
        return 'success';
      });
      assert.strictEqual(result, 'success');
      assert.strictEqual(attempts, 1);
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const result = await retry(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      }, { maxAttempts: 3, delay: 10 });
      assert.strictEqual(result, 'success');
      assert.strictEqual(attempts, 3);
    });

    it('should throw after max attempts', async () => {
      let attempts = 0;
      await assert.rejects(
        retry(async () => {
          attempts++;
          throw new Error('always fail');
        }, { maxAttempts: 2, delay: 10 }),
        { message: 'always fail' }
      );
      assert.strictEqual(attempts, 2);
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes in time', async () => {
      const result = await withTimeout(Promise.resolve('done'), 100);
      assert.strictEqual(result, 'done');
    });

    it('should reject on timeout', async () => {
      await assert.rejects(
        withTimeout(new Promise(r => setTimeout(r, 200)), 50, 'Timed out'),
        { message: 'Timed out' }
      );
    });
  });

  describe('ensureUrlScheme', () => {
    it('should add https:// to plain domain', () => {
      assert.strictEqual(ensureUrlScheme('example.com'), 'https://example.com');
    });

    it('should not modify URLs with scheme', () => {
      assert.strictEqual(ensureUrlScheme('https://example.com'), 'https://example.com');
      assert.strictEqual(ensureUrlScheme('http://example.com'), 'http://example.com');
    });

    it('should add http:// to localhost', () => {
      assert.strictEqual(ensureUrlScheme('localhost:3000'), 'http://localhost:3000');
    });

    it('should add http:// to IP addresses', () => {
      assert.strictEqual(ensureUrlScheme('192.168.1.1'), 'https://192.168.1.1');
    });

    it('should return empty string for empty input', () => {
      assert.strictEqual(ensureUrlScheme(''), '');
      assert.strictEqual(ensureUrlScheme(null), null);
    });
  });

  describe('looksLikeUrlToken', () => {
    it('should identify URLs with schemes', () => {
      assert.strictEqual(looksLikeUrlToken('https://example.com'), true);
      assert.strictEqual(looksLikeUrlToken('http://example.com'), true);
    });

    it('should identify domain-like tokens', () => {
      assert.strictEqual(looksLikeUrlToken('example.com'), true);
      assert.strictEqual(looksLikeUrlToken('www.example.com'), true);
    });

    it('should reject non-URL tokens', () => {
      assert.strictEqual(looksLikeUrlToken('profile-name'), false);
      assert.strictEqual(looksLikeUrlToken('just text'), false);
    });

    it('should handle empty/null inputs', () => {
      assert.strictEqual(looksLikeUrlToken(''), false);
      assert.strictEqual(looksLikeUrlToken(null), false);
      assert.strictEqual(looksLikeUrlToken(undefined), false);
    });
  });

  describe('getPositionals', () => {
    it('should extract positional arguments', () => {
      const args = ['cmd', 'arg1', 'arg2'];
      assert.deepStrictEqual(getPositionals(args), ['cmd', 'arg1', 'arg2']);
    });

    it('should filter out flags', () => {
      const args = ['cmd', '--flag', 'value', 'arg1', '--other'];
      assert.deepStrictEqual(getPositionals(args), ['cmd', 'arg1']);
    });

    it('should return empty array when no positionals', () => {
      const args = ['--flag', 'value', '--other'];
      assert.deepStrictEqual(getPositionals(args), []);
    });

    it('should handle excludeFlags', () => {
      const args = ['cmd', '-p', 'profile1', 'arg1'];
      assert.deepStrictEqual(getPositionals(args, ['-p']), ['cmd', 'arg1']);
    });
  });
});
