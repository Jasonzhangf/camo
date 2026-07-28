import test from 'node:test';
import assert from 'node:assert/strict';
import * as bs from '../../../services/browser_service/bootstrap.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

bs.__enableTestRoot();

test('positive: describe returns module manifest without side effects', () => {
  const m = bs.describe();
  assert.equal(m.moduleId, 'services.browser_service');
  assert.equal(m.layer, 'L2_service');
  assert.equal(m.role, 'orchestrator');
  assert.ok(m.owner_for.includes('services.session'));
});

test('positive: boot returns plan with expected steps and dryRun', () => {
  const plan = bs.boot({ profileId: 'p1', mode: 'background', headless: true });
  assert.equal(plan.profileId, 'p1');
  assert.equal(plan.mode, 'background');
  assert.equal(plan.headless, true);
  assert.equal(plan.dryRun, true);
  const stepIds = plan.steps.map((s) => s.id);
  assert.ok(stepIds.includes('lock.acquire'));
  assert.ok(stepIds.includes('session.create'));
  assert.ok(stepIds.includes('tab_pool.ensure'));
  assert.ok(stepIds.includes('display.read'));
  assert.ok(stepIds.includes('autoscript.start'));
});

test('positive: boot defaults mode to background when omitted', () => {
  const plan = bs.boot({ profileId: 'p2' });
  assert.equal(plan.mode, 'background');
});

test('negative: invalid mode throws E_INPUT_OUT_OF_RANGE', () => {
  let err;
  try { bs.boot({ profileId: 'p3', mode: 'rainbow' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_OUT_OF_RANGE');
  assert.equal(err?.details?.field, 'mode');
});

test('negative: empty profileId throws E_INPUT_MISSING_FIELD', () => {
  let err;
  try { bs.boot({ profileId: '' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_MISSING_FIELD');
});

test('negative: illegal profileId characters throw E_INPUT_INVALID', () => {
  let err;
  try { bs.boot({ profileId: 'has space' }); } catch (e) { err = e; }
  assert.equal(err?.code, 'E_INPUT_INVALID');
});
