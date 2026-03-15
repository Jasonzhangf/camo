import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const originalFetch = global.fetch;

describe('command log', () => {
  beforeEach(() => {
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/health')) {
        return { ok: true, status: 200 };
      }
      if (String(url).includes('/command')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, echoed: JSON.parse(options.body || '{}') }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('appends a command log row with sender cwd and args', async () => {
    const { COMMAND_LOG_FILE, appendCommandLog } = await import('../../../src/utils/command-log.mjs');
    if (fs.existsSync(COMMAND_LOG_FILE)) fs.unlinkSync(COMMAND_LOG_FILE);

    const row = appendCommandLog({
      action: 'click',
      command: 'click',
      profileId: 'profile-a',
      args: ['profile-a', '--selector', '.btn'],
      payload: { selector: '.btn' },
      meta: {
        source: 'cli',
        cwd: '/tmp/test-cwd',
        pid: 123,
        ppid: 45,
        sender: { source: 'cli', cwd: '/tmp/test-cwd', pid: 123, ppid: 45, argv: ['node', 'camo', 'click'] },
      },
    });

    assert.equal(row.meta.cwd, '/tmp/test-cwd');
    assert.equal(row.meta.sender.cwd, '/tmp/test-cwd');
    const lines = fs.readFileSync(COMMAND_LOG_FILE, 'utf8').trim().split('\n');
    const last = JSON.parse(lines.at(-1));
    assert.equal(last.action, 'click');
    assert.equal(last.meta.sender.cwd, '/tmp/test-cwd');
    assert.deepEqual(last.args, ['profile-a', '--selector', '.btn']);
  });
});
