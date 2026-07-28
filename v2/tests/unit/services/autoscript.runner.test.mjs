import test from 'node:test';
import assert from 'node:assert/strict';
import * as run from '../../../services/autoscript/runner.mjs';
import * as click from '../../../services/autoscript/actions/click.mjs';
import * as type from '../../../services/autoscript/actions/type.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

run.__enableTestRoot();

test('positive: start -> markRunning -> markFinished transitions', () => {
  run.__resetForTest();
  const r = run.start('run-1', 'p1');
  assert.equal(r.status, 'pending');
  const r2 = run.markRunning('run-1');
  assert.equal(r2.status, 'running');
  const r3 = run.markFinished('run-1');
  assert.equal(r3.status, 'finished');
  assert.ok(r3.finishedAt);
  const events = run.lifecycle().map((e) => e.kind);
  assert.ok(events.includes('start'));
  assert.ok(events.includes('running'));
  assert.ok(events.includes('finished'));
});

test('positive: execute() invokes registered action and steps counter increments', () => {
  run.__resetForTest();
  run.registerAction('click', click);
  run.start('run-2', 'p2');
  const ctx = {
    profileId: 'p2',
    match: (q, snap) => ({ primary: snap[0] || null }),
    snapshot: () => [{ id: 'btn-1', role: 'button', text: 'OK', visible: true, inViewport: true }],
  };
  const out = run.execute('run-2', 'click', { id: 'btn-1' }, ctx);
  assert.equal(out.ok, true);
  assert.equal(out.kind, 'click');
  assert.equal(out.containerId, 'btn-1');
  assert.equal(run.status('run-2').stepCount, 1);
});

test('positive: execute(type, ...) without target returns containerId null but ok', () => {
  run.__resetForTest();
  run.registerAction('type', type);
  run.start('run-3', 'p3');
  const ctx = {
    profileId: 'p3',
    match: () => ({ primary: null }),
    snapshot: () => [],
  };
  const out = run.execute('run-3', 'type', { text: 'hello' }, ctx);
  assert.equal(out.ok, true);
  assert.equal(out.text, 'hello');
});

test('positive: stop on terminal is a no-op', () => {
  run.__resetForTest();
  run.start('run-4', 'p4');
  run.markFinished('run-4');
  const r = run.stop('run-4');
  assert.equal(r.status, 'finished');
});

test('positive: listActions returns sorted action ids', () => {
  run.__resetForTest();
  run.registerAction('click', click);
  run.registerAction('type', type);
  assert.deepEqual(run.listActions(), ['click', 'type']);
});

test('negative: transition on terminal throws E_STATE_TERMINAL', () => {
  run.__resetForTest();
  run.start('run-5', 'p5');
  run.markFinished('run-5');
  let err;
  try { run.markRunning('run-5'); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_STATE_TERMINAL');
  assert.equal(err?.details?.current, 'finished');
});

test('negative: markFinished without error on failed throws E_INPUT_MISSING_FIELD', () => {
  // markFailed requires error; we exercise that path.
  run.__resetForTest();
  run.start('run-6', 'p6');
  let err;
  try { run.markFailed('run-6'); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
  assert.equal(err?.details?.field, 'error');
});

test('negative: execute unknown actionId throws E_PROTO_NO_HANDLER', () => {
  run.__resetForTest();
  run.start('run-7', 'p7');
  let err;
  try { run.execute('run-7', 'noop', {}, {}); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_PROTO_NO_HANDLER');
});

test('negative: execute on missing runId throws E_STATE_NOT_FOUND', () => {
  let err;
  try { run.execute('never', 'click', {}, {}); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_STATE_NOT_FOUND');
});

test('negative: duplicate action registration throws E_STATE_DUPLICATE', () => {
  run.__resetForTest();
  run.registerAction('click', click);
  let err;
  try { run.registerAction('click', click); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_STATE_DUPLICATE');
});
