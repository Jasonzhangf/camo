import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

const originalFetch = global.fetch;

describe('browser-service utilities', () => {
  beforeEach(() => {
    global.fetch = async (url, options) => {
      if (url.includes('/health')) {
        return { ok: true, status: 200 };
      }
      if (url.includes('/command')) {
        const body = JSON.parse(options.body);
        if (body.action === 'getStatus') {
          return {
            ok: true,
            json: async () => ({ sessions: [] }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      }
      return { ok: true, json: async () => ({}) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('module exports', () => {
    it('should export required functions', async () => {
      const bs = await import('../../../src/utils/browser-service.mjs');
      assert.strictEqual(typeof bs.callAPI, 'function');
      assert.strictEqual(typeof bs.getSessionByProfile, 'function');
      assert.strictEqual(typeof bs.checkBrowserService, 'function');
      assert.strictEqual(typeof bs.detectCamoufoxPath, 'function');
      assert.strictEqual(typeof bs.ensureCamoufox, 'function');
      assert.strictEqual(typeof bs.ensureBrowserService, 'function');
      assert.strictEqual(typeof bs.findRepoRootCandidate, 'function');
    });
  });

  describe('checkBrowserService', () => {
    it('should return true when service is healthy', async () => {
      const { checkBrowserService } = await import('../../../src/utils/browser-service.mjs');
      const result = await checkBrowserService();
      assert.strictEqual(result, true);
    });

    it('should return false when service is not running', async () => {
      global.fetch = async () => { throw new Error('Connection refused'); };
      const { checkBrowserService } = await import('../../../src/utils/browser-service.mjs');
      const result = await checkBrowserService();
      assert.strictEqual(result, false);
    });
  });

  describe('callAPI', () => {
    it('should call fetch with correct parameters', async () => {
      let calledUrl = null;
      let calledOptions = null;
      global.fetch = async (url, options) => {
        calledUrl = url;
        calledOptions = options;
        return { ok: true, json: async () => ({ result: 'ok' }) };
      };
      const { callAPI } = await import('../../../src/utils/browser-service.mjs');
      const result = await callAPI('/test-action', { foo: 'bar' });
      assert.ok(calledUrl.includes('/command'));
      assert.strictEqual(calledOptions.method, 'POST');
      assert.strictEqual(result.result, 'ok');
    });

    it('should throw on HTTP error', async () => {
      global.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      const { callAPI } = await import('../../../src/utils/browser-service.mjs');
      await assert.rejects(
        async () => callAPI('/error-action', {}),
        /HTTP 500/
      );
    });

    it('should throw on error response', async () => {
      global.fetch = async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad request' }),
      });
      const { callAPI } = await import('../../../src/utils/browser-service.mjs');
      await assert.rejects(
        async () => callAPI('/error-action', {}),
        /Bad request/
      );
    });
  });

  describe('getSessionByProfile', () => {
    it('should return session when found', async () => {
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          sessions: [
            { profileId: 'profile-a', sessionId: 'sid-a' },
            { profileId: 'profile-b', sessionId: 'sid-b' },
          ],
        }),
      });
      const { getSessionByProfile } = await import('../../../src/utils/browser-service.mjs');
      const session = await getSessionByProfile('profile-a');
      assert.strictEqual(session.profileId, 'profile-a');
    });

    it('should return null when not found', async () => {
      global.fetch = async () => ({
        ok: true,
        json: async () => ({ sessions: [] }),
      });
      const { getSessionByProfile } = await import('../../../src/utils/browser-service.mjs');
      const session = await getSessionByProfile('nonexistent');
      assert.strictEqual(session, null);
    });
  });

  describe('detectCamoufoxPath', () => {
    it('should return null or string', async () => {
      const { detectCamoufoxPath } = await import('../../../src/utils/browser-service.mjs');
      const result = detectCamoufoxPath();
      assert.ok(result === null || typeof result === 'string');
    });
  });

  describe('findRepoRootCandidate', () => {
    it('should return null or a valid path', async () => {
      const { findRepoRootCandidate } = await import('../../../src/utils/browser-service.mjs');
      const result = findRepoRootCandidate();
      assert.ok(result === null || typeof result === 'string');
    });
  });
});
