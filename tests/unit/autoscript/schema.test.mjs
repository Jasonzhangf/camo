import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  explainAutoscript,
  loadAndValidateAutoscript,
  loadAutoscriptFile,
  normalizeAutoscript,
  validateAutoscript,
} from '../../../src/autoscript/schema.mjs';

describe('autoscript schema', () => {
  it('normalizes and validates a simple script', () => {
    const normalized = normalizeAutoscript({
      name: 'demo',
      profileId: 'profile-a',
      subscriptions: [
        { id: 'search_input', selector: '#search-input' },
      ],
      operations: [
        {
          id: 'fill',
          action: 'type',
          selector: '#search-input',
          text: 'hello',
          trigger: 'search_input.appear',
        },
      ],
    });

    const validation = validateAutoscript(normalized);
    assert.strictEqual(validation.ok, true);
    assert.deepStrictEqual(validation.errors, []);
    assert.strictEqual(normalized.operations[0].params.selector, '#search-input');
  });

  it('detects unresolved references and dependency cycles', () => {
    const normalized = normalizeAutoscript({
      subscriptions: [
        { id: 's1', selector: '.a' },
      ],
      operations: [
        { id: 'a', action: 'wait', ms: 0, trigger: 'missing.appear', dependsOn: ['b'] },
        { id: 'b', action: 'wait', ms: 0, dependsOn: ['a'] },
      ],
    });
    const validation = validateAutoscript(normalized);
    assert.strictEqual(validation.ok, false);
    assert.ok(validation.errors.some((msg) => msg.includes('unknown trigger subscription')));
    assert.ok(validation.errors.some((msg) => msg.includes('dependency cycle')));
  });

  it('explains normalized operation order', () => {
    const normalized = normalizeAutoscript({
      subscriptions: [{ id: 's1', selector: '.x' }],
      operations: [
        { id: 'first', action: 'wait', ms: 0, trigger: 'startup' },
        { id: 'second', action: 'wait', ms: 0, trigger: 'startup', dependsOn: ['first'] },
      ],
    });
    const explained = explainAutoscript(normalized);
    assert.strictEqual(explained.ok, true);
    assert.deepStrictEqual(explained.operationOrder, ['first', 'second']);
  });

  it('normalizes trigger/condition/params variants and defaults', () => {
    const normalized = normalizeAutoscript({
      defaults: {
        retry: { attempts: 2, backoffMs: 9 },
        impact: 'subscription',
        onFailure: 'continue',
        validationMode: 'post',
        recovery: { attempts: 3, actions: ['requery_container'] },
        pacing: {
          operationMinIntervalMs: 1200,
          eventCooldownMs: 800,
          jitterMs: 200,
          navigationMinIntervalMs: 2500,
          timeoutMs: 70000,
        },
        timeoutMs: 70000,
      },
      subscriptions: [
        null,
        { selector: '.auto-id' },
        { id: 's2', selector: '.custom', events: [] },
      ],
      operations: [
        null,
        {
          action: 'type',
          selector: '#search-input',
          text: 'hello',
          trigger: '  ',
          conditions: [
            'operation_done:opA',
            'subscription_exist:s2',
            'subscription_appear:s2',
            '',
          ],
        },
        {
          id: 'manual_obj',
          action: 'wait',
          params: { ms: 1, note: true },
          trigger: { type: 'manual' },
          conditions: [{ type: 'operation_done', operationId: 'opA' }],
          checkpoint: { targetCheckpoint: 'search_ready' },
        },
        {
          id: 'unknown_trigger',
          action: 'wait',
          trigger: { foo: 'bar' },
          enabled: false,
        },
      ],
    });

    assert.strictEqual(normalized.subscriptions.length, 2);
    assert.strictEqual(normalized.subscriptions[0].id, 'subscription_2');
    assert.deepStrictEqual(normalized.subscriptions[0].events, ['appear', 'exist', 'disappear', 'change']);

    const op1 = normalized.operations[0];
    assert.strictEqual(op1.id, 'operation_2');
    assert.strictEqual(op1.trigger.type, 'startup');
    assert.deepStrictEqual(op1.params, { selector: '#search-input', text: 'hello' });
    assert.deepStrictEqual(op1.conditions, [
      { type: 'operation_done', operationId: 'opA' },
      { type: 'subscription_exist', subscriptionId: 's2' },
      { type: 'subscription_appear', subscriptionId: 's2' },
    ]);
    assert.deepStrictEqual(op1.retry, { attempts: 2, backoffMs: 9 });
    assert.strictEqual(op1.onFailure, 'continue');
    assert.strictEqual(op1.impact, 'subscription');
    assert.deepStrictEqual(op1.pacing, {
      operationMinIntervalMs: 1200,
      eventCooldownMs: 800,
      jitterMs: 200,
      navigationMinIntervalMs: 2500,
      timeoutMs: 70000,
    });
    assert.strictEqual(op1.timeoutMs, 70000);
    assert.strictEqual(op1.validation.mode, 'post');
    assert.deepStrictEqual(op1.checkpoint.recovery, { attempts: 3, actions: ['requery_container'] });

    const op2 = normalized.operations[1];
    assert.strictEqual(op2.trigger.type, 'manual');
    assert.deepStrictEqual(op2.params, { ms: 1, note: true });
    assert.strictEqual(op2.checkpoint.targetCheckpoint, 'search_ready');

    const op3 = normalized.operations[2];
    assert.strictEqual(op3.trigger.type, 'unknown');
    assert.strictEqual(op3.enabled, false);
  });

  it('validates duplicates/unknown refs/unknown trigger and warnings', () => {
    const normalized = normalizeAutoscript({
      subscriptions: [
        { id: 's1', selector: '.a' },
        { id: 's1', selector: '.b' },
      ],
      operations: [
        {
          id: 'dup',
          action: 'wait',
          trigger: 'invalid-trigger-format',
          dependsOn: ['missing-op'],
          conditions: [
            { type: 'operation_done', operationId: 'missing-op-2' },
            { type: 'subscription_exist', subscriptionId: 'missing-sub' },
          ],
          enabled: false,
        },
        {
          id: 'dup',
          action: 'wait',
          trigger: { subscriptionId: 's1', event: 'appear' },
        },
      ],
    });
    const validation = validateAutoscript(normalized);
    assert.strictEqual(validation.ok, false);
    assert.ok(validation.errors.some((msg) => msg.includes('duplicate subscription id: s1')));
    assert.ok(validation.errors.some((msg) => msg.includes('duplicate operation id: dup')));
    assert.ok(validation.errors.some((msg) => msg.includes('unsupported trigger')));
    assert.ok(validation.errors.some((msg) => msg.includes('unknown dependency')));
    assert.ok(validation.errors.some((msg) => msg.includes('unknown condition operation')));
    assert.ok(validation.errors.some((msg) => msg.includes('unknown condition subscription')));
    assert.ok(validation.warnings.some((msg) => msg.includes('operation dup is disabled')));
  });

  it('loads autoscript file and handles IO/JSON errors', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-schema-'));
    const goodPath = path.join(tmpDir, 'good.json');
    const badPath = path.join(tmpDir, 'bad.json');
    const missingPath = path.join(tmpDir, 'missing.json');

    fs.writeFileSync(goodPath, JSON.stringify({
      name: 'from-file',
      subscriptions: [{ id: 's1', selector: '.x' }],
      operations: [{ id: 'op1', action: 'wait', trigger: 'startup' }],
    }));
    fs.writeFileSync(badPath, '{ not-json');

    const loaded = loadAutoscriptFile(goodPath);
    assert.strictEqual(loaded.resolvedPath, path.resolve(goodPath));
    assert.strictEqual(loaded.payload.name, 'from-file');

    assert.throws(() => loadAutoscriptFile(missingPath), /Autoscript file not found/);
    assert.throws(() => loadAutoscriptFile(badPath), /Invalid autoscript JSON/);

    const loadedAndValidated = loadAndValidateAutoscript(goodPath);
    assert.strictEqual(loadedAndValidated.validation.ok, true);
    assert.strictEqual(loadedAndValidated.script.name, 'from-file');
  });
});
