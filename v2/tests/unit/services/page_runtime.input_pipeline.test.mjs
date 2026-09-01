import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as inp from '../../../services/page_runtime/input_pipeline.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import * as progressLog from '../../../services/progress_event/log.mjs';

inp.__enableTestRoot();
progressLog.__enableTestRoot();
const progressRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-pipeline-events-'));
progressLog.__setRunsRootForTest(progressRoot);

test('positive: run() without executor returns executed:false and clears running', () => {
  inp.__resetForTest();
  const out = inp.run('p1', { kind: 'click', params: { id: 'btn' } });
  assert.equal(out.kind, 'click');
  assert.equal(out.executed, false);
  const s = inp.status('p1');
  assert.equal(s.running, false);
  assert.equal(s.lastKind, 'click');
});

test('positive: run() with executor returns executor result and clears running', () => {
  inp.__resetForTest();
  let seen = null;
  const out = inp.run('p2', { kind: 'type', params: { text: 'hello' } }, (ctx) => {
    seen = ctx;
    return { ok: true, took: 7 };
  });
  assert.equal(out.ok, true);
  assert.equal(out.took, 7);
  assert.equal(seen.kind, 'type');
  assert.equal(inp.status('p2').running, false);
});

test('positive: serialized — second run while running throws E_STATE_LOCKED', () => {
  inp.__resetForTest();
  // start a long-running executor
  let release;
  const releaseAt = new Promise((res) => { release = res; });
  const started = inp.run('p3', { kind: 'scroll' }, async () => {
    await releaseAt;
    return { ok: true };
  });
  let err;
  try { inp.run('p3', { kind: 'click' }); } catch (e) { err = e; }
  release();
  return started.then(() => {
    assert.equal(err?.code, 'E_STATE_LOCKED');
    assert.equal(err?.details?.kind, 'scroll');
  });
});

test('negative: invalid kind throws E_INPUT_OUT_OF_RANGE', () => {
  let err;
  try { inp.run('p4', { kind: 'magic' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_OUT_OF_RANGE');
  assert.equal(err?.details?.allowed.includes('click'), true);
});

test('negative: empty profileId throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { inp.status(''); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: executor throws → wrapped in E_INTERNAL_UNEXPECTED, running cleared', () => {
  inp.__resetForTest();
  let err;
  try {
    inp.run('p5', { kind: 'click' }, () => { throw new Error('boom'); });
  } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INTERNAL_UNEXPECTED');
  assert.equal(inp.status('p5').running, false);
  assert.ok(inp.status('p5').lastError);
});

test('positive: concurrent operations on different profiles are isolated', async () => {
  inp.__resetForTest();
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  const a = inp.run('agent-a', { kind: 'click' }, async () => {
    await gateA;
    return { agent: 'a' };
  });
  const b = inp.run('agent-b', { kind: 'type' }, async () => ({ agent: 'b' }));
  assert.deepEqual(await b, { agent: 'b' });
  assert.equal(inp.status('agent-b').running, false);
  releaseA();
  assert.deepEqual(await a, { agent: 'a' });
  assert.equal(inp.status('agent-a').running, false);
});

test('negative: async timeout aborts the pipeline and emits an abort event', async () => {
  inp.__resetForTest();
  const profile = 'timeout-abort';
  let aborted = false;
  const pending = inp.run(profile, { kind: 'click', params: { timeout: 20 } }, (_, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('operation aborted'));
    }, { once: true });
  }));

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'E_IO_TIMEOUT');
    assert.equal(error.details.profileId, profile);
    return true;
  });

  assert.equal(inp.status(profile).running, false);
  assert.equal(aborted, true);
  const events = progressLog.readRecent('anonymous').filter((entry) => entry.profileId === profile);
  assert.equal(events.at(-1).event, 'pipeline.aborted');
  assert.equal(events.at(-1).payload.kind, 'click');

  const next = inp.run(profile, { kind: 'click' }, () => ({ ok: true }));
  assert.deepEqual(next, { ok: true });
});

test('negative: executor failure remains explicit without an abort event', () => {
  inp.__resetForTest();
  const profile = 'ordinary-failure';
  let error;
  try {
    inp.run(profile, { kind: 'click' }, () => { throw new Error('wheel failed'); });
  } catch (cause) {
    error = cause;
  }

  assert.equal(error.code, 'E_INTERNAL_UNEXPECTED');
  assert.equal(inp.status(profile).running, false);
  const events = progressLog.readRecent('anonymous').filter((entry) => entry.profileId === profile);
  assert.equal(events.some((entry) => entry.event === 'pipeline.aborted'), false);
});

test('negative: nested WS timeout remains an abort event', () => {
  inp.__resetForTest();
  const profile = 'nested-ws-timeout';
  const cause = Object.assign(new Error('WS timeout'), { code: 'E_IO_TIMEOUT' });
  let error;
  try {
    inp.run(profile, { kind: 'click' }, () => {
      const wrapped = new CamoError({
        code: 'E_BROWSER_CLICK_FAILED',
        details: { reason: 'WS timeout' },
        cause,
      });
      throw wrapped;
    });
  } catch (caught) {
    error = caught;
  }

  assert.equal(error.code, 'E_INTERNAL_UNEXPECTED');
  assert.equal(inp.status(profile).running, false);
  const events = progressLog.readRecent('anonymous').filter((entry) => entry.profileId === profile);
  assert.equal(events.at(-1).event, 'pipeline.aborted');
  assert.equal(events.at(-1).payload.kind, 'click');
});

test('negative: untyped WS timeout text does not emit an abort event', () => {
  inp.__resetForTest();
  const profile = 'untyped-ws-timeout';
  let error;
  try {
    inp.run(profile, { kind: 'click' }, () => {
      throw new Error('WS timeout');
    });
  } catch (caught) {
    error = caught;
  }

  assert.equal(error.code, 'E_INTERNAL_UNEXPECTED');
  assert.equal(inp.status(profile).running, false);
  const events = progressLog.readRecent('anonymous').filter((entry) => entry.profileId === profile);
  assert.equal(events.some((entry) => entry.event === 'pipeline.aborted'), false);
});
