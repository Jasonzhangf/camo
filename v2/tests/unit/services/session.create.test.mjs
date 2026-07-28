import test from 'node:test';
import assert from 'node:assert/strict';
import * as session from '../../../services/session/manager.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

session.__enableTestRoot();

test('positive: create returns a session with monotonic fields', () => {
  session.__resetForTest();
  const s = session.create('prof-a', { alias: 'main', headless: true });
  assert.equal(s.profileId, 'prof-a');
  assert.equal(s.alias, 'main');
  assert.equal(s.status, 'active');
  assert.ok(s.instanceId.startsWith('inst_'));
  assert.ok(typeof s.startedAt === 'string');
  assert.ok(typeof s.updatedAt === 'string');
});

test('positive: list returns sorted by startedAt', async () => {
  session.__resetForTest();
  session.create('a', {});
  await new Promise((r) => setTimeout(r, 2));
  session.create('b', {});
  const all = session.list();
  assert.equal(all.length, 2);
  assert.ok(all[0].startedAt <= all[1].startedAt);
});

test('positive: update preserves immutable profileId/instanceId', () => {
  session.__resetForTest();
  const s = session.create('c', { alias: 'one' });
  const updated = session.update('c', { alias: 'two', status: 'reconnecting' });
  assert.equal(updated.profileId, s.profileId);
  assert.equal(updated.instanceId, s.instanceId);
  assert.equal(updated.alias, 'two');
  assert.equal(updated.status, 'reconnecting');
});

test('positive: markClosed closes and keeps record readable', () => {
  session.__resetForTest();
  session.create('d', {});
  const closed = session.markClosed('d');
  assert.equal(closed.status, 'closed');
  assert.equal(session.read('d').status, 'closed');
});

test('positive: isAliasTaken detects duplicate aliases', () => {
  session.__resetForTest();
  session.create('e', { alias: 'shared' });
  assert.equal(session.isAliasTaken('shared'), true);
  assert.equal(session.isAliasTaken('free'), false);
});

test('positive: lifecycle appends events on create/update/delete', () => {
  session.__resetForTest();
  session.create('f', {});
  session.update('f', { headless: true });
  session.deleteSession('f');
  const evs = session.lifecycle().map((e) => e.kind);
  assert.deepEqual(evs, ['create', 'update', 'delete']);
});
