import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

const originalFetch = global.fetch;

describe('record command', () => {
  const calls = [];

  beforeEach(() => {
    calls.length = 0;
    global.fetch = async (url, options = {}) => {
      const text = String(url || '');
      if (text.includes('/health')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (text.includes('/command')) {
        const body = JSON.parse(options.body || '{}');
        calls.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            action: body.action,
            args: body.args || {},
            recording: { active: body.action !== 'record:stop', enabled: body.action !== 'record:stop' },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exports handler', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    assert.strictEqual(typeof mod.handleRecordCommand, 'function');
  });

  it('dispatches record start with name/output/overlay options', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mod.handleRecordCommand([
        'record',
        'start',
        'unit-profile',
        '--name',
        'manual-run',
        '--output',
        './tmp/unit-record.jsonl',
        '--no-overlay',
      ]);
    } finally {
      console.log = originalLog;
    }

    const command = calls.find((item) => item.action === 'record:start');
    assert.ok(command);
    assert.strictEqual(command.args.profileId, 'unit-profile');
    assert.strictEqual(command.args.name, 'manual-run');
    assert.strictEqual(command.args.overlay, false);
    assert.strictEqual(command.args.outputPath, path.resolve('./tmp/unit-record.jsonl'));
    assert.ok(logs.some((line) => line.includes('"action": "record:start"')));
  });

  it('supports record status and stop', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    await mod.handleRecordCommand(['record', 'status', 'unit-profile']);
    await mod.handleRecordCommand(['record', 'stop', 'unit-profile', '--reason', 'manual-stop']);

    const statusCmd = calls.find((item) => item.action === 'record:status');
    const stopCmd = calls.find((item) => item.action === 'record:stop');
    assert.ok(statusCmd);
    assert.ok(stopCmd);
    assert.strictEqual(statusCmd.args.profileId, 'unit-profile');
    assert.strictEqual(stopCmd.args.profileId, 'unit-profile');
    assert.strictEqual(stopCmd.args.reason, 'manual-stop');
  });

  it('prints usage when subcommand is missing or unknown', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mod.handleRecordCommand(['record']);
      await mod.handleRecordCommand(['record', 'unknown']);
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes('Usage: camo record <start|stop|status>')));
  });

  it('supports --profile flag and --overlay on record start', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    await mod.handleRecordCommand([
      'record',
      'start',
      '--profile',
      'flag-profile',
      '--name',
      'run-2',
      '--overlay',
    ]);
    const command = calls.find((item) => item.action === 'record:start' && item.args.profileId === 'flag-profile');
    assert.ok(command);
    assert.strictEqual(command.args.name, 'run-2');
    assert.strictEqual(command.args.overlay, true);
  });

  it('fails without profile/default for start/stop/status', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    const { setDefaultProfile, getDefaultProfile } = await import('../../../src/utils/config.mjs');
    const prevDefault = getDefaultProfile();
    setDefaultProfile(null);
    try {
      await assert.rejects(
        async () => mod.handleRecordCommand(['record', 'start']),
        /Usage: camo record start/,
      );
      await assert.rejects(
        async () => mod.handleRecordCommand(['record', 'stop']),
        /Usage: camo record stop/,
      );
      await assert.rejects(
        async () => mod.handleRecordCommand(['record', 'status']),
        /Usage: camo record status/,
      );
    } finally {
      setDefaultProfile(prevDefault || null);
    }
  });

  it('rejects record start with missing --name value', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    await assert.rejects(
      async () => mod.handleRecordCommand(['record', 'start', 'unit-profile', '--name']),
      /Usage: camo record start .* --name <name>/,
    );
  });

  it('rejects record start with missing --output value', async () => {
    const mod = await import('../../../src/commands/record.mjs');
    await assert.rejects(
      async () => mod.handleRecordCommand(['record', 'start', 'unit-profile', '--output']),
      /Usage: camo record start .* --output <file>/,
    );
  });
});
