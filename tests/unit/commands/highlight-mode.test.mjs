import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('highlight-mode command', () => {
  it('exports handler', async () => {
    const mod = await import('../../../src/commands/highlight-mode.mjs');
    assert.strictEqual(typeof mod.handleHighlightModeCommand, 'function');
  });

  it('supports on/off/status', async () => {
    const mod = await import('../../../src/commands/highlight-mode.mjs');
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mod.handleHighlightModeCommand(['highlight-mode', 'off']);
      await mod.handleHighlightModeCommand(['highlight-mode', 'status']);
      await mod.handleHighlightModeCommand(['highlight-mode', 'on']);
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes('"highlightMode": false')));
    assert.ok(logs.some((line) => line.includes('"highlightMode": true')));
  });

  it('rejects invalid subcommand', async () => {
    const mod = await import('../../../src/commands/highlight-mode.mjs');
    await assert.rejects(
      async () => mod.handleHighlightModeCommand(['highlight-mode', 'invalid']),
      /Usage: camo highlight-mode \[status\|on\|off\]/,
    );
  });
});
