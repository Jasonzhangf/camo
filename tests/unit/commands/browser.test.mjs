import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  handleStopCommand,
  computeStartWindowSize,
  syncWindowViewportAfterResize,
  requestDevtoolsOpen,
} from '../../../src/commands/browser.mjs';
import { acquireLock, isLocked, releaseLock } from '../../../src/lifecycle/lock.mjs';
import { registerSession, getSessionInfo, unregisterSession } from '../../../src/lifecycle/session-registry.mjs';

const WATCHDOG_DIR = path.join(os.homedir(), '.webauto', 'run', 'camo-watchdogs');
const originalFetch = global.fetch;
const TEST_PROFILE = `test-browser-stop-${Date.now()}`;

function getWatchdogFile(profileId) {
  return path.join(WATCHDOG_DIR, `${profileId}.json`);
}

describe('browser command', () => {
  beforeEach(() => {
    fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) {
        return { ok: true, status: 200 };
      }
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'stop') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'stop failed for test' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    releaseLock(TEST_PROFILE);
    unregisterSession(TEST_PROFILE);
    const watchdogFile = getWatchdogFile(TEST_PROFILE);
    if (fs.existsSync(watchdogFile)) fs.unlinkSync(watchdogFile);
  });

  it('cleans local lifecycle state even when remote stop fails', async () => {
    acquireLock(TEST_PROFILE, { sessionId: 'sid-test' });
    registerSession(TEST_PROFILE, { sessionId: 'sid-test' });
    fs.writeFileSync(getWatchdogFile(TEST_PROFILE), JSON.stringify({ profileId: TEST_PROFILE, pid: -1 }));

    await assert.rejects(
      async () => handleStopCommand(['stop', TEST_PROFILE]),
      /stop failed for test/,
    );

    assert.strictEqual(isLocked(TEST_PROFILE), false);
    assert.strictEqual(getSessionInfo(TEST_PROFILE), null);
    assert.strictEqual(fs.existsSync(getWatchdogFile(TEST_PROFILE)), false);
  });

  it('supports stop by alias', async () => {
    const profileId = `${TEST_PROFILE}-alias`;
    registerSession(profileId, { sessionId: 'sid-alias', alias: 'alias-stop-test' });
    acquireLock(profileId, { sessionId: 'sid-alias' });

    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) return { ok: true, status: 200 };
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'stop') {
          return { ok: true, status: 200, json: async () => ({ ok: true, profileId: body.args.profileId }) };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    await handleStopCommand(['stop', '--alias', 'alias-stop-test']);
    assert.strictEqual(getSessionInfo(profileId), null);
    assert.strictEqual(isLocked(profileId), false);
    unregisterSession(profileId);
    releaseLock(profileId);
  });

  it('rejects stop --alias/--id without value to avoid stopping default profile', async () => {
    await assert.rejects(
      async () => handleStopCommand(['stop', '--alias']),
      /Usage: camo stop --alias <alias>/,
    );
    await assert.rejects(
      async () => handleStopCommand(['stop', '--id']),
      /Usage: camo stop --id <instanceId>/,
    );
  });

  it('supports close all', async () => {
    const p1 = `${TEST_PROFILE}-all-1`;
    const p2 = `${TEST_PROFILE}-all-2`;
    registerSession(p1, { sessionId: 'sid-1' });
    registerSession(p2, { sessionId: 'sid-2' });
    acquireLock(p1, { sessionId: 'sid-1' });
    acquireLock(p2, { sessionId: 'sid-2' });

    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) return { ok: true, status: 200 };
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'getStatus') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sessions: [{ profileId: p1 }, { profileId: p2 }] }),
          };
        }
        if (body.action === 'stop') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (value) => logs.push(value);
    try {
      await handleStopCommand(['close', 'all']);
    } finally {
      console.log = originalConsoleLog;
    }

    const payload = JSON.parse(String(logs.at(-1) || '{}'));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.mode, 'all');
    assert.strictEqual(getSessionInfo(p1), null);
    assert.strictEqual(getSessionInfo(p2), null);
    assert.strictEqual(isLocked(p1), false);
    assert.strictEqual(isLocked(p2), false);
    unregisterSession(p1);
    unregisterSession(p2);
    releaseLock(p1);
    releaseLock(p2);
  });

  it('supports stop idle', async () => {
    const idleProfile = `${TEST_PROFILE}-idle`;
    const activeProfile = `${TEST_PROFILE}-active`;
    registerSession(idleProfile, {
      sessionId: 'sid-idle',
      headless: true,
      idleTimeoutMs: 500,
      lastActivityAt: Date.now() - 10_000,
      status: 'active',
    });
    registerSession(activeProfile, {
      sessionId: 'sid-active',
      headless: true,
      idleTimeoutMs: 3600_000,
      lastActivityAt: Date.now(),
      status: 'active',
    });
    acquireLock(idleProfile, { sessionId: 'sid-idle' });
    acquireLock(activeProfile, { sessionId: 'sid-active' });

    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) return { ok: true, status: 200 };
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'stop') {
          return { ok: true, status: 200, json: async () => ({ ok: true, profileId: body.args.profileId }) };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (value) => logs.push(value);
    try {
      await handleStopCommand(['stop', 'idle']);
    } finally {
      console.log = originalConsoleLog;
    }

    const payload = JSON.parse(String(logs.at(-1) || '{}'));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.mode, 'idle');
    assert.strictEqual(payload.targetCount, 1);
    assert.strictEqual(getSessionInfo(idleProfile), null);
    assert.notStrictEqual(getSessionInfo(activeProfile), null);
    unregisterSession(idleProfile);
    unregisterSession(activeProfile);
    releaseLock(idleProfile);
    releaseLock(activeProfile);
  });

  it('stop idle includes live headless sessions missing local registry', async () => {
    const orphanLiveProfile = `${TEST_PROFILE}-orphan-live-headless`;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) return { ok: true, status: 200 };
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'getStatus') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sessions: [
                { profileId: orphanLiveProfile, mode: 'headless' },
              ],
            }),
          };
        }
        if (body.action === 'stop') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, profileId: body?.args?.profileId || null }),
          };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (value) => logs.push(value);
    try {
      await handleStopCommand(['stop', 'idle']);
    } finally {
      console.log = originalConsoleLog;
    }

    const payload = JSON.parse(String(logs.at(-1) || '{}'));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.mode, 'idle');
    assert.strictEqual(payload.targetCount, 1);
    assert.strictEqual(payload.orphanLiveHeadlessCount, 1);
    assert.strictEqual(payload.results[0]?.profileId, orphanLiveProfile);
  });

  it('dispatches devtools shortcut and reports viewport-based verification', async () => {
    const profileId = `${TEST_PROFILE}-devtools-ok`;
    let evalCall = 0;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) return { ok: true, status: 200 };
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'keyboard:press') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (body.action === 'evaluate') {
          evalCall += 1;
          const size = evalCall === 1
            ? { width: 1600, height: 900 }
            : { width: 1600, height: 720 };
          return { ok: true, status: 200, json: async () => ({ ok: true, result: size }) };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const result = await requestDevtoolsOpen(profileId, { shortcuts: ['F12'], settleMs: 0 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.requested, true);
    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.attempts.length, 1);
    assert.strictEqual(result.attempts[0].ok, true);
  });

  it('returns failure when all devtools shortcut dispatches fail', async () => {
    const profileId = `${TEST_PROFILE}-devtools-fail`;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) return { ok: true, status: 200 };
      if (String(url).includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        if (body.action === 'keyboard:press') {
          return { ok: false, status: 500, json: async () => ({ error: 'keyboard failed' }) };
        }
        if (body.action === 'evaluate') {
          return { ok: true, status: 200, json: async () => ({ ok: true, result: { width: 1600, height: 900 } }) };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const result = await requestDevtoolsOpen(profileId, { shortcuts: ['F12'], settleMs: 0 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.requested, true);
    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.attempts.length, 1);
    assert.strictEqual(result.attempts[0].ok, false);
  });
});

describe('browser start window sizing helpers', () => {
  const prevReserve = process.env.CAMO_DEFAULT_WINDOW_VERTICAL_RESERVE;

  afterEach(() => {
    global.fetch = originalFetch;
    if (prevReserve === undefined) {
      delete process.env.CAMO_DEFAULT_WINDOW_VERTICAL_RESERVE;
    } else {
      process.env.CAMO_DEFAULT_WINDOW_VERTICAL_RESERVE = prevReserve;
    }
  });

  it('computes near-fullscreen size from work area by default', () => {
    delete process.env.CAMO_DEFAULT_WINDOW_VERTICAL_RESERVE;
    const result = computeStartWindowSize({
      metrics: { workWidth: 2560, workHeight: 1415 },
    });
    assert.deepStrictEqual(result, {
      width: 2560,
      height: 1343,
      reservePx: 72,
      source: 'workArea',
    });
  });

  it('falls back to sane defaults when display metrics are unavailable', () => {
    const result = computeStartWindowSize(null);
    assert.deepStrictEqual(result, {
      width: 1920,
      height: 1000,
      reservePx: 72,
      source: 'fallback',
    });
  });

  it('syncs viewport after resizing startup window', async () => {
    const actions = [];
    let evaluateCalls = 0;
    global.fetch = async (url, options = {}) => {
      if (!String(url).includes('/command')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const body = JSON.parse(options.body || '{}');
      actions.push(body);
      if (body.action === 'window:resize') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (body.action === 'page:setViewport') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (body.action === 'evaluate') {
        evaluateCalls += 1;
        if (evaluateCalls === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ result: { innerWidth: 1200, innerHeight: 700, outerWidth: 1366, outerHeight: 900 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { innerWidth: 1246, innerHeight: 720, outerWidth: 1366, outerHeight: 900 } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const result = await syncWindowViewportAfterResize('profile-1', 1366, 900, {
      settleMs: 1,
      attempts: 2,
      tolerancePx: 0,
    });

    const resizeAction = actions.find((item) => item.action === 'window:resize');
    const setViewportAction = actions.find((item) => item.action === 'page:setViewport');
    assert.ok(resizeAction);
    assert.ok(setViewportAction);
    assert.strictEqual(setViewportAction.args.width, 1246);
    assert.strictEqual(setViewportAction.args.height, 720);
    assert.strictEqual(result.targetViewport.matched, true);
  });
});
