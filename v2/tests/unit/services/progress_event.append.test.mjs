import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as log from '../../../services/progress_event/log.mjs';

log.__enableTestRoot();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-evt-'));
log.__setRunsRootForTest(tmpRoot);

test('positive: append adds a JSONL record', () => {
  const rec = log.append({ runId: 'r1', profileId: 'p1', source: 'cli', mode: 'normal', event: 'cmd.start', payload: { cmd: 'start' } });
  assert.equal(rec.runId, 'r1');
  assert.equal(rec.profileId, 'p1');
  assert.ok(typeof rec.ts === 'string');
  const recent = log.readRecent('r1');
  assert.equal(recent.length, 1);
  assert.equal(recent[0].event, 'cmd.start');
});

test('positive: readRecent honors limit', () => {
  for (let i = 0; i < 5; i += 1) log.append({ runId: 'r2', event: 'ev', source: 's' });
  const last2 = log.readRecent('r2', { limit: 2 });
  assert.equal(last2.length, 2);
});

test('positive: listRuns returns run dirs with events.jsonl', () => {
  log.append({ runId: 'r3', event: 'ev', source: 's' });
  const runs = log.listRuns();
  assert.ok(runs.includes('r3'));
});

test('positive: payload defaults to null when missing', () => {
  const rec = log.append({ runId: 'r4', event: 'ev', source: 's' });
  assert.equal(rec.payload, null);
});
