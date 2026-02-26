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
      assert.strictEqual(typeof bs.findInstallRootCandidate, 'function');
      assert.strictEqual(typeof bs.getDomSnapshotByProfile, 'function');
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

    it('should timeout when browser-service does not respond', async () => {
      global.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) return;
        if (signal.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
          return;
        }
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
      const { callAPI } = await import('../../../src/utils/browser-service.mjs');
      await assert.rejects(
        async () => callAPI('probe:timeout', { profileId: 'profile-a', x: 1, y: 2 }, { timeoutMs: 10 }),
        /timeout/i,
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

    it('should recover session from page:list when getStatus is empty', async () => {
      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.action === 'getStatus') {
          return {
            ok: true,
            json: async () => ({ sessions: [] }),
          };
        }
        if (body.action === 'page:list') {
          return {
            ok: true,
            json: async () => ({
              pages: [{ index: 0, url: 'https://www.xiaohongshu.com/explore', active: true }],
              activeIndex: 0,
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      };
      const { getSessionByProfile } = await import('../../../src/utils/browser-service.mjs');
      const session = await getSessionByProfile('profile-a');
      assert.strictEqual(session.profileId, 'profile-a');
      assert.strictEqual(session.current_url, 'https://www.xiaohongshu.com/explore');
      assert.strictEqual(session.recoveredFromPages, true);
    });
  });

  describe('getDomSnapshotByProfile', () => {
    it('should attach viewport metadata on snapshot root', async () => {
      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.action === 'evaluate') {
          return {
            ok: true,
            json: async () => ({
              result: {
                dom_tree: { tag: 'body', children: [] },
                viewport: { width: 1440, height: 900 },
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      };
      const { getDomSnapshotByProfile } = await import('../../../src/utils/browser-service.mjs');
      const snapshot = await getDomSnapshotByProfile('profile-a');
      assert.strictEqual(snapshot.tag, 'body');
      assert.deepStrictEqual(snapshot.__viewport, { width: 1440, height: 900 });
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

  describe('findInstallRootCandidate', () => {
    it('should return null or a valid path', async () => {
      const { findInstallRootCandidate } = await import('../../../src/utils/browser-service.mjs');
      const result = findInstallRootCandidate();
      assert.ok(result === null || typeof result === 'string');
    });
  });
});
