import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleWindowCommand } from '../../../src/commands/window.mjs';
import { PROFILES_DIR } from '../../../src/utils/config.mjs';

const originalFetch = global.fetch;
const originalConsoleLog = console.log;
const TEST_PROFILE = `test-profile-${Date.now()}`;

describe('window command', () => {
  let innerWidth = 1100;
  let innerHeight = 700;
  let outerWidth = 1400;
  let outerHeight = 900;
  let viewportCalls = 0;
  let logs = [];

  beforeEach(() => {
    innerWidth = 1100;
    innerHeight = 700;
    outerWidth = 1400;
    outerHeight = 900;
    viewportCalls = 0;
    logs = [];
    console.log = (line) => logs.push(String(line));

    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }

      if (!String(url).includes('/command')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'not found' }),
        };
      }

      const body = JSON.parse(options.body || '{}');
      const action = body?.action;
      const args = body?.args || {};

      if (action === 'window:resize') {
        outerWidth = Number(args.width || outerWidth);
        outerHeight = Number(args.height || outerHeight);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, window: { width: outerWidth, height: outerHeight } }),
        };
      }

      if (action === 'evaluate') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: { innerWidth, innerHeight, outerWidth, outerHeight },
          }),
        };
      }

      if (action === 'page:setViewport') {
        viewportCalls += 1;
        innerWidth = Number(args.width || innerWidth);
        innerHeight = Number(args.height || innerHeight);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, viewport: { width: innerWidth, height: innerHeight } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    console.log = originalConsoleLog;
    const profileDir = path.join(PROFILES_DIR, TEST_PROFILE);
    if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  });

  it('syncs viewport after window resize and reports matched=true', async () => {
    await handleWindowCommand(['window', 'resize', TEST_PROFILE, '--width', '1920', '--height', '1080']);
    assert.ok(viewportCalls >= 1);

    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.ok, true);
    assert.equal(payload.profileId, TEST_PROFILE);
    assert.equal(payload.targetViewport.matched, true);
    assert.equal(payload.verified.innerWidth, payload.targetViewport.width);
    assert.equal(payload.verified.innerHeight, payload.targetViewport.height);
    assert.equal(payload.profileWindow.width, payload.verified.outerWidth);
    assert.equal(payload.profileWindow.height, payload.verified.outerHeight);
  });
});
