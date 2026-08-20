import test from 'node:test';
import assert from 'node:assert/strict';
import * as session from '../../../services/session/manager.mjs';

session.__enableTestRoot();

test('positive: touch updates updatedAt on an existing session', async () => {
  session.__resetForTest();
  const record = session.create('touch-a', {});
  const before = Date.parse(record.updatedAt);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const touched = session.touch('touch-a');
  assert.equal(touched.profileId, 'touch-a');
  assert.ok(Date.parse(touched.updatedAt) >= before, 'touch must advance updatedAt');
});

test('negative: touch on a missing session returns null without creating a record', () => {
  session.__resetForTest();
  assert.equal(session.touch('touch-missing'), null);
  assert.equal(session.tryRead('touch-missing'), null);
});

test('positive: touch lifecycle telemetry is capped to prevent unbounded growth', () => {
  session.__resetForTest();
  session.create('touch-cap', {});
  for (let i = 0; i < 4200; i += 1) session.touch('touch-cap');
  const events = session.lifecycle();
  assert.ok(events.length <= 4096, 'lifecycle log must stay bounded');
  assert.ok(events.every((event) => typeof event.profileId === 'string'));
});
