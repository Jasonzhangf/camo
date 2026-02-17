import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

describe('progress log', () => {
  let tmpDir = null;
  let eventsFile = null;
  let previousFileEnv = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-progress-log-'));
    eventsFile = path.join(tmpDir, 'events.jsonl');
    previousFileEnv = process.env.CAMO_PROGRESS_EVENTS_FILE;
    process.env.CAMO_PROGRESS_EVENTS_FILE = eventsFile;
  });

  afterEach(() => {
    if (previousFileEnv === undefined) delete process.env.CAMO_PROGRESS_EVENTS_FILE;
    else process.env.CAMO_PROGRESS_EVENTS_FILE = previousFileEnv;
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends and reads recent events', async () => {
    const mod = await import('../../../src/events/progress-log.mjs');
    const first = mod.appendProgressEvent({
      source: 'test',
      mode: 'normal',
      profileId: 'p1',
      event: 'unit.first',
      payload: { n: 1 },
    });
    const second = mod.appendProgressEvent({
      source: 'test',
      mode: 'autoscript',
      profileId: 'p1',
      runId: 'run-1',
      event: 'unit.second',
      payload: { n: 2 },
    });

    assert.ok(fs.existsSync(eventsFile));
    assert.strictEqual(first.event, 'unit.first');
    assert.strictEqual(second.runId, 'run-1');

    const recent = mod.readRecentProgressEvents(1);
    assert.strictEqual(recent.length, 1);
    assert.strictEqual(recent[0].event, 'unit.second');
    assert.strictEqual(recent[0].mode, 'autoscript');
  });
});

