import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { AutoscriptRunner } from '../../../src/autoscript/runtime.mjs';
import { normalizeAutoscript, validateAutoscript } from '../../../src/autoscript/schema.mjs';

const originalFetch = global.fetch;

describe('autoscript runtime', () => {
  let currentUrl;
  let snapshots;
  let snapshotIndex;

  beforeEach(() => {
    currentUrl = 'https://www.xiaohongshu.com/explore';
    snapshots = [
      { tag: 'body', children: [] },
      { tag: 'body', children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }] },
      { tag: 'body', children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }] },
    ];
    snapshotIndex = 0;

    global.fetch = async (url, options) => {
      if (String(url).includes('/command')) {
        const body = JSON.parse(options?.body || '{}');
        const action = body.action;
        const args = body.args || {};
        if (action === 'getStatus') {
          return { ok: true, json: async () => ({ sessions: [{ profileId: 'p1', sessionId: 's1' }] }) };
        }
        if (action === 'evaluate') {
          if (String(args.script || '').includes('window.location.href')) {
            return { ok: true, json: async () => ({ result: currentUrl }) };
          }
          if (String(args.script || '').includes('dom_tree')) {
            const snap = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
            snapshotIndex += 1;
            return { ok: true, json: async () => ({ result: { dom_tree: snap, viewport: { width: 1280, height: 720 } } }) };
          }
          return { ok: true, json: async () => ({ result: { ok: true } }) };
        }
        return { ok: true, json: async () => ({ ok: true, result: { ok: true } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('runs dependency chain on subscription events', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      throttle: 100,
      subscriptions: [{ id: 'search_input', selector: '#search-input', events: ['appear'] }],
      operations: [
        { id: 'fill', action: 'type', selector: '#search-input', text: 'hello', trigger: 'search_input.appear' },
        { id: 'next', action: 'wait', ms: 0, trigger: 'search_input.appear', dependsOn: ['fill'] },
      ],
    });
    const validation = validateAutoscript(script);
    assert.strictEqual(validation.ok, true);

    const logs = [];
    const runner = new AutoscriptRunner(script, {
      profileId: 'p1',
      log: (payload) => logs.push(payload),
    });

    const runtime = await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 450));
    runtime.stop('test_done');
    await runtime.done;

    const opDone = logs.filter((row) => row.event === 'autoscript:operation_done').map((row) => row.operationId);
    assert.ok(opDone.includes('fill'));
    assert.ok(opDone.includes('next'));
  });

  it('deduplicates exist-trigger operations on unchanged subscription state', async () => {
    snapshots = [
      { tag: 'body', children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }] },
      { tag: 'body', children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }] },
      { tag: 'body', children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }] },
      { tag: 'body', children: [{ tag: 'input', id: 'search-input', classes: ['search-input'] }] },
    ];
    snapshotIndex = 0;
    const script = normalizeAutoscript({
      profileId: 'p1',
      throttle: 100,
      subscriptions: [{ id: 's1', selector: '#search-input', events: ['appear', 'exist', 'change'] }],
      operations: [
        { id: 'op_once_per_state', action: 'wait', ms: 0, trigger: 's1.exist', once: false },
      ],
    });

    const logs = [];
    const runner = new AutoscriptRunner(script, {
      profileId: 'p1',
      log: (payload) => logs.push(payload),
    });

    const runtime = await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 420));
    runtime.stop('test_done');
    await runtime.done;

    const doneCount = logs.filter(
      (row) => row.event === 'autoscript:operation_done' && row.operationId === 'op_once_per_state',
    ).length;
    assert.strictEqual(doneCount, 1);
  });

  it('stops script when impact=script operation fails', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      throttle: 100,
      subscriptions: [],
      operations: [
        {
          id: 'bad',
          action: 'evaluate',
          params: {},
          trigger: 'startup',
          retry: { attempts: 1, backoffMs: 0 },
          checkpoint: { recovery: { attempts: 0, actions: [] } },
          impact: 'script',
          onFailure: 'chain_stop',
        },
      ],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, {
      profileId: 'p1',
      log: (payload) => logs.push(payload),
    });
    const runtime = await runner.start();
    const done = await runtime.done;
    assert.strictEqual(done.reason, 'script_failure');
    assert.ok(logs.some((row) => row.event === 'autoscript:impact' && row.scope === 'script'));
  });

  it('evaluates trigger/condition/scheduling guards', () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 's1', selector: '#search-input', events: ['appear', 'exist', 'disappear'] }],
      operations: [
        { id: 'dep', action: 'wait', ms: 0, trigger: 'startup' },
        {
          id: 'op',
          action: 'wait',
          ms: 0,
          trigger: 's1.appear',
          dependsOn: ['dep'],
          conditions: [
            { type: 'operation_done', operationId: 'dep' },
            { type: 'subscription_exist', subscriptionId: 's1' },
            { type: 'subscription_appear', subscriptionId: 's1' },
          ],
        },
      ],
    });
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: () => {} });
    const op = script.operations.find((item) => item.id === 'op');

    assert.strictEqual(runner.isTriggered(op, { type: 'appear', subscriptionId: 's1' }), true);
    assert.strictEqual(runner.isTriggered({ ...op, trigger: { type: 'manual' } }, { type: 'manual' }), true);
    assert.strictEqual(runner.isTriggered({ ...op, trigger: { type: 'unknown' } }, { type: 'appear', subscriptionId: 's1' }), false);

    assert.strictEqual(runner.isConditionSatisfied({ type: 'unknown' }), false);
    assert.strictEqual(runner.isConditionSatisfied({ type: 'operation_done', operationId: 'dep' }), false);

    runner.operationState.set('dep', { status: 'done' });
    runner.subscriptionState.set('s1', { exists: true, appearCount: 1 });
    assert.strictEqual(runner.isDependencySatisfied({ dependsOn: ['dep'] }), true);
    assert.strictEqual(runner.isConditionSatisfied({ type: 'operation_done', operationId: 'dep' }), true);
    assert.strictEqual(runner.isConditionSatisfied({ type: 'subscription_exist', subscriptionId: 's1' }), true);
    assert.strictEqual(runner.isConditionSatisfied({ type: 'subscription_appear', subscriptionId: 's1' }), true);
    assert.strictEqual(runner.areConditionsSatisfied(op), true);

    runner.operationState.set('dep', { status: 'skipped' });
    assert.strictEqual(runner.isDependencySatisfied({ dependsOn: ['dep'] }), true);
    assert.strictEqual(runner.isConditionSatisfied({ type: 'operation_done', operationId: 'dep' }), false);
    runner.operationState.set('dep', { status: 'done' });

    assert.strictEqual(runner.shouldSchedule(op, { type: 'appear', subscriptionId: 's1' }), true);
    assert.strictEqual(runner.shouldSchedule({ ...op, enabled: false }, { type: 'appear', subscriptionId: 's1' }), false);
    runner.operationState.set('op', { status: 'done' });
    assert.strictEqual(runner.shouldSchedule({ ...op, once: true }, { type: 'appear', subscriptionId: 's1' }), false);

    const oncePerAppearOp = {
      ...op,
      trigger: { type: 'subscription_event', subscriptionId: 's1', event: 'exist' },
      once: false,
      oncePerAppear: true,
      pacing: { operationMinIntervalMs: 1200, eventCooldownMs: 800 },
    };
    assert.strictEqual(runner.shouldSchedule(oncePerAppearOp, { type: 'exist', subscriptionId: 's1' }), true);
    runner.operationScheduleState.set('op', {
      ...(runner.operationScheduleState.get('op') || {}),
      lastScheduledAppearCount: 1,
      lastCompletedAppearCount: 1,
      lastTriggerKey: 's1:exist:a1',
    });
    assert.strictEqual(runner.shouldSchedule(oncePerAppearOp, { type: 'exist', subscriptionId: 's1' }), false);
    runner.subscriptionState.set('s1', { exists: true, appearCount: 2 });
    assert.strictEqual(runner.shouldSchedule(oncePerAppearOp, { type: 'exist', subscriptionId: 's1' }), true);
  });

  it('marks oncePerAppear operation as completed for current appear cycle', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 'detail_modal', selector: '.note-detail-mask', events: ['appear', 'exist', 'disappear'] }],
      operations: [
        {
          id: 'close_detail',
          action: 'wait',
          ms: 0,
          trigger: 'detail_modal.exist',
          once: false,
          oncePerAppear: true,
        },
      ],
    });

    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: () => {} });
    runner.state.active = true;
    runner.subscriptionState.set('detail_modal', { exists: true, appearCount: 1, version: 1 });
    runner.executeOnce = async () => ({ ok: true, data: { closed: true } });

    runner.enqueueOperation(script.operations[0], { type: 'exist', subscriptionId: 'detail_modal' });
    await runner.operationQueue;

    const scheduleState = runner.operationScheduleState.get('close_detail');
    assert.strictEqual(scheduleState.lastCompletedAppearCount, 1);
    assert.strictEqual(runner.shouldSchedule(script.operations[0], { type: 'exist', subscriptionId: 'detail_modal' }), false);

    runner.subscriptionState.set('detail_modal', { exists: true, appearCount: 2, version: 3 });
    assert.strictEqual(runner.shouldSchedule(script.operations[0], { type: 'exist', subscriptionId: 'detail_modal' }), true);
  });

  it('resets oncePerAppear operation state to pending when new appear cycle starts', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 'detail_modal', selector: '.note-detail-mask', events: ['appear', 'exist', 'disappear'] }],
      operations: [
        {
          id: 'detail_harvest',
          action: 'wait',
          ms: 0,
          trigger: 'detail_modal.exist',
          once: false,
          oncePerAppear: true,
        },
      ],
    });
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: () => {} });
    runner.state.active = true;
    runner.operationState.set('detail_harvest', {
      status: 'done',
      runs: 1,
      lastError: null,
      updatedAt: new Date().toISOString(),
      result: { ok: true },
    });

    await runner.handleEvent({ type: 'appear', subscriptionId: 'detail_modal' });
    assert.strictEqual(runner.operationState.get('detail_harvest')?.status, 'pending');
  });

  it('skips operation when trigger state is stale before execution', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 'detail_modal', selector: '.note-detail-mask', events: ['appear', 'exist', 'disappear'] }],
      operations: [],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: (payload) => logs.push(payload) });
    runner.state.active = true;
    runner.subscriptionState.set('detail_modal', { exists: false, appearCount: 1, version: 2 });

    let executeCount = 0;
    runner.executeOnce = async () => {
      executeCount += 1;
      return { ok: true, data: { pass: true } };
    };

    const result = await runner.runOperation({
      id: 'detail_harvest',
      action: 'evaluate',
      trigger: { type: 'subscription_event', subscriptionId: 'detail_modal', event: 'exist' },
      retry: { attempts: 1, backoffMs: 0 },
      impact: 'op',
      onFailure: 'continue',
    }, {
      type: 'exist',
      subscriptionId: 'detail_modal',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(executeCount, 0);
    assert.ok(logs.some((row) => row.event === 'autoscript:operation_skipped' && row.reason === 'stale_trigger'));
    assert.strictEqual(runner.operationState.get('detail_harvest')?.status, 'skipped');
  });

  it('treats pre-validation failure as stale skip when trigger already invalid', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 'detail_modal', selector: '.note-detail-mask', events: ['appear', 'exist', 'disappear'] }],
      operations: [],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: (payload) => logs.push(payload) });
    runner.state.active = true;
    runner.subscriptionState.set('detail_modal', { exists: true, appearCount: 2, version: 4 });

    runner.executeOnce = async () => {
      runner.subscriptionState.set('detail_modal', { exists: false, appearCount: 2, version: 5 });
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed at phase=pre',
        data: { phase: 'pre', detail: { code: 'VALIDATION_FAILED' } },
      };
    };
    runner.runRecovery = async () => ({ ok: false, code: 'RECOVERY_NOT_CONFIGURED', message: 'n/a' });

    const result = await runner.runOperation({
      id: 'comments_harvest',
      action: 'evaluate',
      trigger: { type: 'subscription_event', subscriptionId: 'detail_modal', event: 'exist' },
      retry: { attempts: 2, backoffMs: 0 },
      impact: 'op',
      onFailure: 'continue',
    }, {
      type: 'exist',
      subscriptionId: 'detail_modal',
    });

    assert.strictEqual(result.ok, true);
    assert.ok(logs.some((row) => row.event === 'autoscript:operation_skipped' && row.reason === 'stale_trigger_pre_validation'));
    assert.strictEqual(logs.some((row) => row.event === 'autoscript:operation_error' && row.operationId === 'comments_harvest'), false);
    assert.strictEqual(runner.operationState.get('comments_harvest')?.status, 'skipped');
  });

  it('does not complete oncePerAppear cycle when scheduling ends with stale skip', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 'detail_modal', selector: '.note-detail-mask', events: ['appear', 'exist', 'disappear'] }],
      operations: [
        {
          id: 'switch_tab_round_robin',
          action: 'wait',
          ms: 0,
          trigger: 'detail_modal.disappear',
          once: false,
          oncePerAppear: true,
        },
      ],
    });
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: () => {} });
    runner.state.active = true;
    runner.subscriptionState.set('detail_modal', { exists: true, appearCount: 3, version: 7 });

    runner.enqueueOperation(script.operations[0], {
      type: 'disappear',
      subscriptionId: 'detail_modal',
    });
    await runner.operationQueue;

    const scheduleState = runner.operationScheduleState.get('switch_tab_round_robin');
    assert.notStrictEqual(scheduleState?.lastCompletedAppearCount, 3);
    assert.strictEqual(runner.operationState.get('switch_tab_round_robin')?.status, 'skipped');
  });

  it('runs retry with backoff and recovery success before finishing', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [],
      operations: [{ id: 'op_retry', action: 'wait', ms: 0, trigger: 'startup' }],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: (payload) => logs.push(payload) });
    const operation = {
      ...script.operations[0],
      retry: { attempts: 2, backoffMs: 1 },
      impact: 'op',
      onFailure: 'chain_stop',
    };

    let executeCount = 0;
    runner.executeOnce = async () => {
      executeCount += 1;
      if (executeCount === 1) {
        return { ok: false, code: 'OPERATION_FAILED', message: 'first attempt failed' };
      }
      return { ok: true, data: { pass: true } };
    };
    runner.runRecovery = async () => ({ ok: true, code: 'RECOVERY_DONE', message: 'ok' });

    const result = await runner.runOperation(operation, { type: 'startup' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(executeCount, 2);
    assert.ok(logs.some((row) => row.event === 'autoscript:operation_recovered'));
    assert.ok(logs.some((row) => row.event === 'autoscript:operation_done'));
  });

  it('executes configured recovery actions and handles recovery exhaustion', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [],
      operations: [],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: (payload) => logs.push(payload) });

    const recovered = await runner.runRecovery(
      {
        id: 'op_ok',
        params: { selector: '#search-input' },
        checkpoint: { recovery: { attempts: 1, actions: ['requery_container'] } },
      },
      { type: 'startup' },
      { code: 'FAIL' },
    );
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.code, 'RECOVERY_DONE');
    assert.ok(logs.some((row) => row.event === 'autoscript:recovery_action' && row.ok === true));

    const exhausted = await runner.runRecovery(
      {
        id: 'op_bad',
        params: { selector: '#missing' },
        checkpoint: { recovery: { attempts: 1, actions: ['requery_container'] } },
      },
      { type: 'startup' },
      { code: 'FAIL' },
    );
    assert.strictEqual(exhausted.ok, false);
    assert.strictEqual(exhausted.code, 'RECOVERY_EXHAUSTED');
    assert.ok(logs.some((row) => row.event === 'autoscript:recovery_action' && row.ok === false));
  });

  it('handles event variants and no-op lifecycle guards', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [{ id: 's1', selector: '#search-input' }],
      operations: [],
    });
    const runner = new AutoscriptRunner(script, { profileId: 'p1', log: () => {} });

    runner.stop('noop_before_start');
    assert.strictEqual(runner.state.active, false);

    runner.state.active = true;
    await runner.handleEvent({ type: 'appear', subscriptionId: 's1' });
    assert.strictEqual(runner.subscriptionState.get('s1').exists, true);
    assert.strictEqual(runner.subscriptionState.get('s1').appearCount, 1);

    await runner.handleEvent({ type: 'exist', subscriptionId: 's1' });
    assert.strictEqual(runner.subscriptionState.get('s1').exists, true);

    await runner.handleEvent({ type: 'disappear', subscriptionId: 's1' });
    assert.strictEqual(runner.subscriptionState.get('s1').exists, false);
  });

  it('treats AUTOSCRIPT_DONE_* as terminal completion', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [],
      operations: [],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, {
      profileId: 'p1',
      log: (payload) => logs.push(payload),
    });
    runner.state.active = true;

    runner.executeOnce = async () => ({
      ok: false,
      code: 'OPERATION_FAILED',
      message: 'page.evaluate: AUTOSCRIPT_DONE_MAX_NOTES',
    });
    runner.runRecovery = async () => ({
      ok: false,
      code: 'RECOVERY_NOT_CONFIGURED',
      message: 'recovery not configured',
    });

    const result = await runner.runOperation({
      id: 'open_next_detail',
      action: 'evaluate',
      retry: { attempts: 1, backoffMs: 0 },
      trigger: { type: 'subscription_event', subscriptionId: 'detail_modal', event: 'disappear' },
      impact: 'script',
      onFailure: 'stop_all',
    }, {
      type: 'disappear',
      subscriptionId: 'detail_modal',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(runner.state.reason, 'script_complete');
    assert.ok(logs.some((row) => row.event === 'autoscript:operation_terminal' && row.code === 'AUTOSCRIPT_DONE_MAX_NOTES'));
    assert.strictEqual(logs.some((row) => row.event === 'autoscript:impact' && row.operationId === 'open_next_detail'), false);
  });

  it('marks operation timeout with configured timeoutMs', async () => {
    const script = normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [],
      operations: [],
    });
    const logs = [];
    const runner = new AutoscriptRunner(script, {
      profileId: 'p1',
      log: (payload) => logs.push(payload),
    });
    runner.state.active = true;
    runner.executeOnce = async () => new Promise(() => {});
    runner.runRecovery = async () => ({
      ok: false,
      code: 'RECOVERY_NOT_CONFIGURED',
      message: 'recovery not configured',
    });

    const result = await runner.runOperation({
      id: 'op_timeout',
      action: 'evaluate',
      timeoutMs: 20,
      retry: { attempts: 1, backoffMs: 0 },
      trigger: { type: 'startup' },
      impact: 'op',
      onFailure: 'continue',
    }, {
      type: 'startup',
    });

    assert.strictEqual(result.ok, false);
    assert.ok(logs.some((row) => row.event === 'autoscript:operation_error' && row.code === 'OPERATION_TIMEOUT'));
  });

  it('validates start guard branches and subscription watch errors', async () => {
    const missingProfileRunner = new AutoscriptRunner(normalizeAutoscript({
      subscriptions: [],
      operations: [],
    }), {
      log: () => {},
    });
    await assert.rejects(() => missingProfileRunner.start(), /profileId is required/);

    const activeRunner = new AutoscriptRunner(normalizeAutoscript({
      profileId: 'p1',
      subscriptions: [],
      operations: [],
    }), {
      profileId: 'p1',
      log: () => {},
    });
    activeRunner.state.active = true;
    await assert.rejects(() => activeRunner.start(), /already running/);

    global.fetch = async (url, options) => {
      if (!String(url).includes('/command')) return { ok: true, json: async () => ({}) };
      const body = JSON.parse(options?.body || '{}');
      if (body.action === 'getStatus') {
        return { ok: true, json: async () => ({ sessions: [{ profileId: 'p1', sessionId: 's1' }] }) };
      }
      if (body.action === 'evaluate') {
        const scriptText = String(body.args?.script || '');
        if (scriptText.includes('window.location.href')) {
          return { ok: true, json: async () => ({ result: 'https://www.xiaohongshu.com/explore' }) };
        }
        if (scriptText.includes('dom_tree')) {
          throw new Error('dom snapshot failed');
        }
      }
      return { ok: true, json: async () => ({ result: { ok: true } }) };
    };

    const logs = [];
    const watchErrorRunner = new AutoscriptRunner(normalizeAutoscript({
      profileId: 'p1',
      throttle: 100,
      subscriptions: [{ id: 's1', selector: '#search-input', events: ['appear'] }],
      operations: [],
    }), {
      profileId: 'p1',
      log: (payload) => logs.push(payload),
    });
    const runtime = await watchErrorRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    runtime.stop('done');
    await runtime.done;

    assert.ok(logs.some((row) => row.event === 'autoscript:watch_error' && String(row.message).includes('dom snapshot failed')));
  });
});
