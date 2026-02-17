import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

describe('events command', () => {
  let tmpDir = null;
  let eventsFile = null;
  let previousFileEnv = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-events-cmd-'));
    eventsFile = path.join(tmpDir, 'events.jsonl');
    previousFileEnv = process.env.CAMO_PROGRESS_EVENTS_FILE;
    process.env.CAMO_PROGRESS_EVENTS_FILE = eventsFile;
  });

  afterEach(() => {
    if (previousFileEnv === undefined) delete process.env.CAMO_PROGRESS_EVENTS_FILE;
    else process.env.CAMO_PROGRESS_EVENTS_FILE = previousFileEnv;
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports handler and supports emit/recent', async () => {
    const mod = await import('../../../src/commands/events.mjs');
    assert.strictEqual(typeof mod.handleEventsCommand, 'function');

    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mod.handleEventsCommand([
        'events',
        'emit',
        '--event',
        'unit.events.emit',
        '--mode',
        'autoscript',
        '--profile',
        'p-test',
        '--payload',
        '{"ok":true}',
      ]);
      await mod.handleEventsCommand(['events', 'recent', '--limit', '1']);
    } finally {
      console.log = originalLog;
    }

    assert.ok(fs.existsSync(eventsFile));
    const raw = fs.readFileSync(eventsFile, 'utf8');
    assert.ok(raw.includes('unit.events.emit'));
    assert.ok(logs.some((line) => line.includes('"command": "events.emit"')));
    assert.ok(logs.some((line) => line.includes('"command": "events.recent"')));
  });
});

