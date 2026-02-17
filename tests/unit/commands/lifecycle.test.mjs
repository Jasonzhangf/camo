import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, isLocked, releaseLock } from '../../../src/lifecycle/lock.mjs';
import { registerSession, getSessionInfo, unregisterSession } from '../../../src/lifecycle/session-registry.mjs';

const WATCHDOG_DIR = path.join(os.homedir(), '.webauto', 'run', 'camo-watchdogs');
const originalFetch = global.fetch;
const TEST_PROFILE = `test-lifecycle-cleanup-${Date.now()}`;

function getWatchdogFile(profileId) {
  return path.join(WATCHDOG_DIR, `${profileId}.json`);
}

describe('lifecycle command', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    releaseLock(TEST_PROFILE);
    unregisterSession(TEST_PROFILE);
    const watchdogFile = getWatchdogFile(TEST_PROFILE);
    if (fs.existsSync(watchdogFile)) fs.unlinkSync(watchdogFile);
  });

  describe('module exports', () => {
    it('should export required functions', async () => {
      const lifecycle = await import('../../../src/commands/lifecycle.mjs');
      assert.strictEqual(typeof lifecycle.handleCleanupCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleForceStopCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleLockCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleUnlockCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleSessionsCommand, 'function');
      assert.strictEqual(typeof lifecycle.handleInstancesCommand, 'function');
    });
  });

  it('cleanup all should cleanup local state even when remote stop fails', async () => {
    const { handleCleanupCommand } = await import('../../../src/commands/lifecycle.mjs');
    fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
    acquireLock(TEST_PROFILE, { sessionId: 'sid-test' });
    registerSession(TEST_PROFILE, { sessionId: 'sid-test' });
    fs.writeFileSync(getWatchdogFile(TEST_PROFILE), JSON.stringify({ profileId: TEST_PROFILE, pid: -1 }));

    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) {
        return { ok: true, status: 200 };
      }
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'getStatus') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sessions: [{ profileId: TEST_PROFILE }] }),
          };
        }
        if (body.action === 'stop') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'stop failed for cleanup-all test' }),
          };
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    };

    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (value) => logs.push(value);

    try {
      await handleCleanupCommand(['cleanup', 'all']);
    } finally {
      console.log = originalConsoleLog;
    }

    assert.strictEqual(isLocked(TEST_PROFILE), false);
    assert.strictEqual(getSessionInfo(TEST_PROFILE), null);
    assert.strictEqual(fs.existsSync(getWatchdogFile(TEST_PROFILE)), false);

    const payload = JSON.parse(String(logs.at(-1) || '{}'));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.sessions[0].ok, false);
    assert.match(payload.sessions[0].error, /stop failed for cleanup-all test/);
  });
});
