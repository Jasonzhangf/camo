import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ImpactEngine } from '../../../src/autoscript/impact-engine.mjs';

describe('impact engine', () => {
  it('supports baseline state checks', () => {
    const engine = new ImpactEngine();
    assert.strictEqual(engine.isScriptStopped(), false);
    assert.strictEqual(engine.isSubscriptionBlocked(null), false);
    assert.strictEqual(engine.isOperationBlocked(null), false);
    assert.strictEqual(engine.canRunOperation({ id: 'op1' }, { subscriptionId: 's1' }), true);
  });

  it('applies continue and stop_all semantics', () => {
    const engine = new ImpactEngine();
    const cont = engine.applyFailure({
      operation: { id: 'op1', onFailure: 'continue', impact: 'op' },
      event: { subscriptionId: 's1' },
    });
    assert.deepStrictEqual(cont, {
      scope: 'none',
      scriptStopped: false,
      blockedSubscriptions: [],
      blockedOperations: [],
    });

    const stopAll = engine.applyFailure({
      operation: { id: 'op1', onFailure: 'stop_all', impact: 'op' },
      event: {},
    });
    assert.strictEqual(stopAll.scope, 'script');
    assert.strictEqual(stopAll.scriptStopped, true);
    assert.strictEqual(engine.isScriptStopped(), true);
    assert.strictEqual(engine.canRunOperation({ id: 'op1' }, {}), false);
  });

  it('applies script and subscription impact semantics', () => {
    const engine = new ImpactEngine();

    const scriptImpact = engine.applyFailure({
      operation: { id: 'op_script', impact: 'script' },
      event: {},
    });
    assert.strictEqual(scriptImpact.scope, 'script');
    assert.strictEqual(scriptImpact.scriptStopped, true);
    assert.strictEqual(engine.isScriptStopped(), true);

    const engine2 = new ImpactEngine();
    const subscriptionImpact = engine2.applyFailure({
      operation: { id: 'op_sub', impact: 'subscription' },
      event: { subscriptionId: 'sub-a' },
    });
    assert.deepStrictEqual(subscriptionImpact, {
      scope: 'subscription',
      scriptStopped: false,
      blockedSubscriptions: ['sub-a'],
      blockedOperations: [],
    });
    assert.strictEqual(engine2.isSubscriptionBlocked('sub-a'), true);
    assert.strictEqual(engine2.canRunOperation({ id: 'op2' }, { subscriptionId: 'sub-a' }), false);
  });

  it('applies chain_stop and op-level fallback semantics', () => {
    const engine = new ImpactEngine();
    const subChainStop = engine.applyFailure({
      operation: { id: 'op_chain', onFailure: 'chain_stop', impact: 'op', trigger: { subscriptionId: 'sub-b' } },
      event: {},
    });
    assert.deepStrictEqual(subChainStop, {
      scope: 'subscription',
      scriptStopped: false,
      blockedSubscriptions: ['sub-b'],
      blockedOperations: [],
    });
    assert.strictEqual(engine.isSubscriptionBlocked('sub-b'), true);

    const engine2 = new ImpactEngine();
    const opChainStop = engine2.applyFailure({
      operation: { id: 'op_chain_only', onFailure: 'chain_stop', impact: 'op' },
      event: {},
    });
    assert.deepStrictEqual(opChainStop, {
      scope: 'op',
      scriptStopped: false,
      blockedSubscriptions: [],
      blockedOperations: ['op_chain_only'],
    });
    assert.strictEqual(engine2.isOperationBlocked('op_chain_only'), true);
    assert.strictEqual(engine2.canRunOperation({ id: 'op_chain_only' }, {}), false);

    const engine3 = new ImpactEngine();
    const fallback = engine3.applyFailure({
      operation: { id: 'op_default', onFailure: 'custom', impact: 'op' },
      event: {},
    });
    assert.deepStrictEqual(fallback, {
      scope: 'op',
      scriptStopped: false,
      blockedSubscriptions: [],
      blockedOperations: ['op_default'],
    });
  });
});

