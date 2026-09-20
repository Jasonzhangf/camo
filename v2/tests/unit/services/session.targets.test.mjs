import test from 'node:test';
import assert from 'node:assert/strict';
import * as session from '../../../services/session/manager.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

session.__enableTestRoot();

test.beforeEach(() => {
  session.__resetForTest();
});

test('positive: allocateTarget binds a stable page to profile/session/generation', () => {
  const record = session.create('target-owner', { instanceId: 'inst-a', generation: 7 });
  const page = { id: 'page-a' };
  const target = session.allocateTarget(record.profileId, page);

  assert.match(target.targetId, /^t_/);
  assert.equal(target.profileId, 'target-owner');
  assert.equal(target.sessionId, 'inst-a');
  assert.equal(target.generation, 7);
  assert.match(target.pageId, /^page_/);
  assert.equal(target.page, page);
  assert.equal(session.resolveTarget(target.targetId).targetId, target.targetId);
  assert.deepEqual(session.listTargets({ profileId: 'target-owner' }).map((entry) => entry.targetId), [target.targetId]);
});

test('negative: multiple targets without explicit target are ambiguous', () => {
  const record = session.create('target-many', { instanceId: 'inst-many', generation: 1 });
  const first = session.allocateTarget(record.profileId, { id: 'first' });
  const second = session.allocateTarget(record.profileId, { id: 'second' });
  let error;
  try {
    session.resolveTargetForProfile(record.profileId);
  } catch (cause) {
    error = cause;
  }
  assert.ok(error instanceof CamoError);
  assert.equal(error.code, 'E_STATE_INVALID');
  assert.deepEqual(error.details.targets.sort(), [first.targetId, second.targetId].sort());
  assert.match(error.details.reason, /multiple active targets/);
});

test('negative: target is stale after session deletion', () => {
  const record = session.create('target-stale', { instanceId: 'inst-stale', generation: 2 });
  const target = session.allocateTarget(record.profileId, { id: 'stale' });
  session.deleteSession(record.profileId);

  assert.throws(
    () => session.resolveTarget(target.targetId),
    (error) => error.code === 'E_STATE_INVALID' && /stale/.test(error.details.reason),
  );
  assert.equal(session.listTargets({ profileId: record.profileId })[0].status, 'stale');
});

test('negative: target from another profile is rejected instead of rebound', () => {
  const a = session.create('target-a', { instanceId: 'inst-a', generation: 3 });
  const b = session.create('target-b', { instanceId: 'inst-b', generation: 4 });
  const target = session.allocateTarget(a.profileId, { id: 'page-a' });

  assert.throws(
    () => session.resolveTarget(target.targetId, { profileId: b.profileId }),
    (error) => error.code === 'E_STATE_INVALID' && /different profile/.test(error.details.reason),
  );
});

test('negative: unknown target is explicit not-found', () => {
  assert.throws(
    () => session.resolveTarget('t_missing'),
    (error) => error.code === 'E_STATE_NOT_FOUND' && error.details.resource === 'browser_target',
  );
});
