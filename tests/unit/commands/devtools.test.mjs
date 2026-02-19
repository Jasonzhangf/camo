import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

const originalFetch = global.fetch;

describe('devtools command', () => {
  beforeEach(() => {
    global.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      if (body.action !== 'evaluate') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const script = String(body.args?.script || '');
      if (script.includes('installCamoDevtoolsConsoleCollector')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { ok: true, installed: true, entries: 0, max: 1000 } }),
        };
      }
      if (script.includes('readCamoDevtoolsConsole')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: {
              ok: true,
              total: 1,
              returned: 1,
              entries: [{ ts: 1, level: 'error', text: 'boom', href: 'https://example.com' }],
            },
          }),
        };
      }
      if (script.includes('runCamoDevtoolsEval')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { ok: true, mode: 'expression', value: 2, valueType: 'number' } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: null }) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exports handler', async () => {
    const mod = await import('../../../src/commands/devtools.mjs');
    assert.strictEqual(typeof mod.handleDevtoolsCommand, 'function');
  });

  it('supports devtools logs with explicit profile', async () => {
    const mod = await import('../../../src/commands/devtools.mjs');
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mod.handleDevtoolsCommand(['devtools', 'logs', 'unit-profile', '--levels', 'error']);
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.length > 0);
    assert.ok(logs.some((line) => line.includes('"command": "devtools.logs"')));
    assert.ok(logs.some((line) => line.includes('"profileId": "unit-profile"')));
    assert.ok(logs.some((line) => line.includes('"level": "error"')));
  });

  it('supports devtools eval with explicit profile flag', async () => {
    const mod = await import('../../../src/commands/devtools.mjs');
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mod.handleDevtoolsCommand(['devtools', 'eval', '--profile', 'unit-profile', '1+1']);
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes('"command": "devtools.eval"')));
    assert.ok(logs.some((line) => line.includes('"value": 2')));
  });

  it('rejects devtools eval without expression', async () => {
    const mod = await import('../../../src/commands/devtools.mjs');
    await assert.rejects(
      async () => mod.handleDevtoolsCommand(['devtools', 'eval', '--profile', 'unit-profile']),
      /Usage: camo devtools eval/,
    );
  });
});
