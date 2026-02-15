import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveProfileId,
  ensureUrlScheme,
  looksLikeUrlToken,
  getPositionals
} from '../../../src/utils/args.mjs';

describe('args utilities', () => {
  describe('resolveProfileId', () => {
    it('should return profileId from args when provided', () => {
      const getDefault = () => 'default-profile';
      const result = resolveProfileId(['cmd', 'arg1', 'my-profile'], 2, getDefault);
      assert.strictEqual(result, 'my-profile');
    });

    it('should return default profile when arg is missing', () => {
      const getDefault = () => 'default-profile';
      const result = resolveProfileId(['cmd', 'arg1'], 2, getDefault);
      assert.strictEqual(result, 'default-profile');
    });

    it('should use explicit profile over default', () => {
      let defaultCalled = false;
      const getDefault = () => { defaultCalled = true; return 'default'; };
      const result = resolveProfileId(['cmd', 'explicit'], 1, getDefault);
      assert.strictEqual(result, 'explicit');
      assert.strictEqual(defaultCalled, false);
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

    it('should trim whitespace', () => {
      assert.strictEqual(ensureUrlScheme('  example.com  '), 'https://example.com');
    });

    it('should return empty string for empty input', () => {
      assert.strictEqual(ensureUrlScheme(''), '');
    });

    it('should handle custom schemes', () => {
      assert.strictEqual(ensureUrlScheme('ftp://files.example.com'), 'ftp://files.example.com');
    });
  });

  describe('looksLikeUrlToken', () => {
    it('should identify URLs with schemes', () => {
      assert.strictEqual(looksLikeUrlToken('https://example.com'), true);
      assert.strictEqual(looksLikeUrlToken('http://localhost:3000'), true);
    });

    it('should identify domain-like tokens', () => {
      assert.strictEqual(looksLikeUrlToken('example.com'), true);
      assert.strictEqual(looksLikeUrlToken('sub.example.co.uk'), true);
    });

    it('should reject non-URL tokens', () => {
      assert.strictEqual(looksLikeUrlToken('profile-name'), false);
      assert.strictEqual(looksLikeUrlToken('xiaohongshu'), false);
      assert.strictEqual(looksLikeUrlToken('batch-1'), false);
    });

    it('should handle empty/null inputs', () => {
      assert.strictEqual(looksLikeUrlToken(null), false);
      assert.strictEqual(looksLikeUrlToken(undefined), false);
      assert.strictEqual(looksLikeUrlToken(''), false);
    });
  });

  describe('getPositionals', () => {
    it('should extract positional arguments', () => {
      const args = ['cmd', 'profile', 'value', '--flag'];
      assert.deepStrictEqual(getPositionals(args, 1), ['profile', 'value']);
    });

    it('should filter out flags', () => {
      const args = ['cmd', '--verbose', 'profile', '--output', 'file'];
      assert.deepStrictEqual(getPositionals(args, 1), ['profile', 'file']);
    });

    it('should return empty array when no positionals', () => {
      const args = ['cmd', '--verbose', '--output', 'file'];
      assert.deepStrictEqual(getPositionals(args, 1), ['file']);
    });
  });
});
