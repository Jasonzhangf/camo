import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as clog from '../../../services/command_log/log.mjs';

clog.__enableTestRoot();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-clog-'));
clog.__setRunsRootForTest(tmpRoot);

test('positive: append in test mode writes a record', () => {
  const rec = clog.append({
    runId: 'r1', cmd: 'start', profileId: 'p1', status: 'ok', durationMs: 12,
    args: ['start', 'p1'], source: 'cli', __testWriter: true,
  });
  assert.equal(rec.cmd, 'start');
  assert.equal(rec.status, 'ok');
  assert.equal(rec.durationMs, 12);
  const all = clog.read('r1');
  assert.equal(all.length, 1);
});

test('positive: error entry includes error string', () => {
  clog.append({
    runId: 'r2', cmd: 'stop', profileId: 'p2', status: 'error', durationMs: 5,
    args: ['stop', 'p2'], source: 'cli', error: 'oops', __testWriter: true,
  });
  const all = clog.read('r2');
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'error');
  assert.equal(all[0].error, 'oops');
});

test('positive: read with limit caps result size', () => {
  for (let i = 0; i < 4; i += 1) {
    clog.append({ runId: 'r3', cmd: 'tick', source: 'cli', args: [], __testWriter: true });
  }
  const a = clog.read('r3', { limit: 2 });
  assert.equal(a.length, 2);
});

test('positive: production-like write with writer:"cli" succeeds when not in test root', () => {
  clog.__resetForTest?.();
  // Outside test mode, writer must be 'cli'
  const rec = clog.append({
    runId: 'r-prod', cmd: 'tick', source: 'cli', args: [], writer: 'cli',
  });
  assert.equal(rec.runId, 'r-prod');
});
