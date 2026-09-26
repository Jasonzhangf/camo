import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGraph, __resetForTest } from '../../../services/autoscript/compiled_runner.mjs';
import * as inboundPipeline from '../../../services/page_runtime/input_pipeline.mjs';
import * as snapshotRegistry from '../../../services/page_runtime/snapshot_registry.mjs';
import * as progressLog from '../../../services/progress_event/log.mjs';
import { CamoError, toWire } from '../../../contracts/error_envelope/projector.mjs';

test('risk checkpoint rejection stops execution with a typed terminal', async () => {
  const graphPath = writeGraph(makeGraph({ nodes: [makeNode({
    id: 'risk', operator: 'test.risk', inputs: ['request'],
    output: { id: 'out', schema: 'Object' }, config: baseConfig({ riskCheckpoint: true }),
  })] }));
  let called = false;
  try {
    for (const riskCheckpoint of [async () => false, async () => { throw new Error('blocked'); }]) {
      await assert.rejects(runGraph({ graphPath, profileId: 'risk',
        options: { riskCheckpoint }, handlers: { 'test.risk': async () => { called = true; } },
      }), error => error instanceof CamoError && toWire(error).terminal === 'risk_blocked');
    }
    await assert.rejects(runGraph({ graphPath, profileId: 'risk',
      options: { riskCheckpoint: async () => { throw new CamoError({ code: 'E_LOGIN_INVALID' }); } },
    }), error => toWire(error).terminal === 'login_invalid');
    assert.equal(called, false);
  } finally { fs.rmSync(path.dirname(graphPath), { recursive: true }); }
});

function writeGraph(graph) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-compiled-runner-'));
  const file = path.join(dir, 'graph.json');
  fs.writeFileSync(file, JSON.stringify(graph, null, 2), 'utf8');
  return file;
}

function makeNode({ id, operator, inputs, output, config = baseConfig(), version = '1' }) {
  return {
    id,
    operator,
    operator_version: version,
    inputs,
    output,
    input_selector: { include: [], exclude: [], predicate: null },
    output_selector: { include: [], exclude: [], predicate: null },
    iterator: 'Whole',
    config,
  };
}

function baseConfig(overrides = {}) {
  return {
    pacingMs: 0,
    jitterMs: 0,
    preValidation: false,
    postValidation: false,
    riskCheckpoint: false,
    ...overrides,
  };
}

function makeGraph({ nodes, edges = [], inputs = [{ id: 'request', schema: 'Object' }], outputs = [nodes[0]?.output?.id].filter(Boolean) }) {
  return {
    id: 'test-graph',
    version: '1',
    inputs,
    nodes,
    edges,
    outputs,
  };
}

function fakePageTarget() {
  const calls = [];
  const locator = {
    async count() { return 1; },
    nth() { return locator; },
    async evaluate() { return { x: 10, y: 10, width: 20, height: 20 }; },
  };
  const page = {
    locator(selector) { calls.push({ selector }); return locator; },
    getByText(text) { calls.push({ text }); return locator; },
    viewportSize() { return { width: 100, height: 100 }; },
    waitForTimeout: async () => {},
    mouse: {
      move: async () => {},
      down: async () => {},
      up: async () => {},
      wheel: async () => {},
    },
    on: () => {},
    off: () => {},
  };
  return { page, status: 'active', targetId: 'target-1', calls };
}

function waitUntil(check, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('condition not met before timeout'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

test.before(() => {
  inboundPipeline.__enableTestRoot();
  progressLog.__enableTestRoot();
  progressLog.__setRunsRootForTest(fs.mkdtempSync(path.join(os.tmpdir(), 'camo-compiled-events-')));
});

test('negative: invalid graph returns E_GRAPH_INVALID before any handler runs', async () => {
  __resetForTest();
  const graph = makeGraph({
    nodes: [
      makeNode({ id: 'a', operator: 'must.not.run', inputs: ['request'], output: { id: 'out_a', schema: 'Object' } }),
      makeNode({ id: 'b', operator: 'must.not.run', inputs: ['out_a'], output: { id: 'out_b', schema: 'Object' } }),
    ],
    edges: [
      { from: 'a', to: 'b', arc_id: 'out_a' },
      { from: 'b', to: 'a', arc_id: 'back' },
    ],
    outputs: ['out_b'],
  });
  const graphPath = writeGraph(graph);
  let handlerCalled = false;
  let beforeExecutionCalled = false;
  await assert.rejects(
    runGraph({
      graphPath,
      profileId: 'invalid-cycle',
      options: { beforeExecution: async () => { beforeExecutionCalled = true; } },
      handlers: {
        'must.not.run': async () => { handlerCalled = true; return {}; },
      },
    }),
    (err) => {
      assert.equal(err?.code, 'E_GRAPH_INVALID');
      return true;
    },
  );
  assert.equal(handlerCalled, false);
  assert.equal(beforeExecutionCalled, false);
});

test('positive: valid graph executes nodes in declared edge order', async () => {
  __resetForTest();
  const order = [];
  const graph = makeGraph({
    nodes: [
      makeNode({ id: 'first', operator: 'test.order.first', inputs: ['request'], output: { id: 'first_out', schema: 'Object' } }),
      makeNode({ id: 'second', operator: 'test.order.second', inputs: ['first_out'], output: { id: 'second_out', schema: 'Object' } }),
    ],
    edges: [
      { from: 'first', to: 'second', arc_id: 'first_out' },
    ],
    outputs: ['second_out'],
  });
  const graphPath = writeGraph(graph);
  const out = await runGraph({
    graphPath,
    profileId: 'order',
    handlers: {
      'test.order.first': async ({ input }) => {
        order.push('first');
        return { seenRequest: input.request?.request === 'ok' };
      },
      'test.order.second': async ({ input }) => {
        order.push('second');
        return { fromFirst: input.first_out };
      },
    },
    request: { request: 'ok' },
  });
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(out.ok, true);
  assert.equal(out.result.fromFirst.seenRequest, true);
});

test('positive: same profile runs are serialized', async () => {
  __resetForTest();
  const graph = makeGraph({
    nodes: [
      makeNode({ id: 'blocked', operator: 'test.serial', inputs: ['request'], output: { id: 'out', schema: 'Object' } }),
    ],
    outputs: ['out'],
  });
  const graphPath = writeGraph(graph);
  let started = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = runGraph({
    graphPath,
    profileId: 'serial-p',
    handlers: {
      'test.serial': async () => {
        started = true;
        await gate;
        return { value: 'first' };
      },
    },
  });
  await waitUntil(() => started);
  let secondResolved = false;
  const second = runGraph({
    graphPath,
    profileId: 'serial-p',
    handlers: {
      'test.serial': async () => ({ value: 'second' }),
    },
  }).then((value) => {
    secondResolved = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondResolved, false);
  release();
  const firstOut = await first;
  assert.deepEqual(firstOut.result, { value: 'first' });
  const secondOut = await second;
  assert.deepEqual(secondOut.result, { value: 'second' });
});

test('positive: execute_input_pipeline derives action locator from validated_target', async () => {
  __resetForTest();
  inboundPipeline.__resetForTest();
  const graph = makeGraph({
    nodes: [
      makeNode({
        id: 'validate',
        operator: 'test.validate',
        inputs: ['request'],
        output: { id: 'validated_target', schema: 'Object' },
      }),
      makeNode({
        id: 'action',
        operator: 'camo.input.action',
        version: '1',
        inputs: ['validated_target'],
        output: { id: 'action_result', schema: 'Object' },
      }),
    ],
    edges: [
      { from: 'validate', to: 'action', arc_id: 'validated_target' },
    ],
    outputs: ['action_result'],
  });
  const graphPath = writeGraph(graph);
  const target = fakePageTarget();
  const out = await runGraph({
    graphPath,
    profileId: 'validated-locator',
    request: { action: { kind: 'click', params: { selector: '#unvalidated', text: 'do not use' } } },
    handlers: {
      'test.validate': async () => ({
        target,
        validated: {
          ref: 'ref:snap:n1',
          role: 'button',
          nameText: 'Be careful',
          stableLocator: '#validated',
        },
      }),
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.result.kind, 'click');
  assert.equal(out.result.result.clicked, true);
  assert.equal(out.result.result.selector, '#validated');
  assert.deepEqual(target.calls, [{ selector: '#validated' }]);
});

test('negative: duplicate stableLocator from semantic query is rejected as ambiguous', async () => {
  __resetForTest();
  inboundPipeline.__resetForTest();
  const profileId = 'autoscript-ambiguous-query';
  const target = { ...fakePageTarget(), profileId };
  const snapshot = {
    profileId,
    targetId: target.targetId,
    documentId: 'doc-ambiguous-query',
    url: 'https://example.test/',
    tree: { nodes: [
      { ref: 'ref:snap-ambiguous-query:n1', role: 'button', nameText: 'First', visible: true, inViewport: true, stableLocator: 'button[aria-label="Same"]' },
      { ref: 'ref:snap-ambiguous-query:n2', role: 'button', nameText: 'Second', visible: true, inViewport: true, stableLocator: 'button[aria-label="Same"]' },
    ] },
  };
  const graphPath = writeGraph(makeGraph({
    nodes: [
      makeNode({ id: 'context', operator: 'test.page_context', inputs: ['request'], output: { id: 'page_context', schema: 'Object' } }),
      makeNode({ id: 'snapshot', operator: 'test.semantic_snapshot', inputs: ['page_context'], output: { id: 'semantic_snapshot', schema: 'Object' } }),
      makeNode({ id: 'validate', operator: 'camo.container.validate', inputs: ['semantic_snapshot', 'page_context'], output: { id: 'validated_target', schema: 'Object' } }),
    ],
    edges: [
      { from: 'context', to: 'snapshot', arc_id: 'page_context' },
      { from: 'context', to: 'validate', arc_id: 'page_context' },
      { from: 'snapshot', to: 'validate', arc_id: 'semantic_snapshot' },
    ],
    outputs: ['validated_target'],
  }));
  const handlers = {
    'test.page_context': async () => target,
    'test.semantic_snapshot': async () => snapshot,
  };
  await assert.rejects(
    runGraph({ graphPath, profileId, request: { action: { kind: 'click', role: 'button' } }, handlers }),
    (error) => error.code === 'E_SNAPSHOT_AMBIGUOUS'
      && error.details?.stableLocator === 'button[aria-label="Same"]'
      && error.details?.reason?.includes('matches multiple snapshot nodes'),
  );
});

test('negative: execute_input_pipeline rejects duplicate stableLocator before protocol input', async () => {
  __resetForTest();
  inboundPipeline.__resetForTest();
  const graph = makeGraph({
    nodes: [
      makeNode({
        id: 'validate',
        operator: 'test.validate',
        inputs: ['request'],
        output: { id: 'validated_target', schema: 'Object' },
      }),
      makeNode({
        id: 'action',
        operator: 'camo.input.action',
        version: '1',
        inputs: ['validated_target'],
        output: { id: 'action_result', schema: 'Object' },
      }),
    ],
    edges: [
      { from: 'validate', to: 'action', arc_id: 'validated_target' },
    ],
    outputs: ['action_result'],
  });
  const graphPath = writeGraph(graph);
  const target = fakePageTarget();
  const duplicateNodes = [
    { ref: 'ref:snap-dup-action:n1', role: 'button', nameText: 'First', stableLocator: 'button[aria-label="Same"]', visible: true, inViewport: true },
    { ref: 'ref:snap-dup-action:n2', role: 'button', nameText: 'Second', stableLocator: 'button[aria-label="Same"]', visible: true, inViewport: true },
  ];
  await assert.rejects(
    runGraph({
      graphPath,
      profileId: 'validated-ambiguous',
      request: { action: { kind: 'click' } },
      handlers: {
        'test.validate': async () => ({
          target,
          tree: { nodes: duplicateNodes },
          validated: { ref: 'ref:snap-dup-action:n1', role: 'button', nameText: 'First', stableLocator: 'button[aria-label="Same"]' },
        }),
      },
    }),
    (error) => error.code === 'E_SNAPSHOT_AMBIGUOUS'
      && error.details?.ref === 'ref:snap-dup-action:n1'
      && error.details?.stableLocator === 'button[aria-label="Same"]',
  );
  assert.deepEqual(target.calls, []);
});

test('negative: execute_input_pipeline rejects a validated node with no mappable locator', async () => {
  __resetForTest();
  inboundPipeline.__resetForTest();
  const graph = makeGraph({
    nodes: [
      makeNode({
        id: 'validate',
        operator: 'test.validate.ref',
        inputs: ['request'],
        output: { id: 'validated_target', schema: 'Object' },
      }),
      makeNode({
        id: 'action',
        operator: 'camo.input.action',
        version: '1',
        inputs: ['validated_target'],
        output: { id: 'action_result', schema: 'Object' },
      }),
    ],
    edges: [
      { from: 'validate', to: 'action', arc_id: 'validated_target' },
    ],
    outputs: ['action_result'],
  });
  const graphPath = writeGraph(graph);
  const target = fakePageTarget();
  await assert.rejects(
    runGraph({
      graphPath,
      profileId: 'unmappable-ref',
      request: { action: { kind: 'click', params: {} } },
      handlers: {
        'test.validate.ref': async () => ({
          target,
          validated: { ref: 'ref:snap:n1', role: 'button' },
        }),
      },
    }),
    (err) => {
      assert.equal(err?.code, 'E_SNAPSHOT_REF_INVALID');
      assert.equal(err?.details?.ref, 'ref:snap:n1');
      return true;
    },
  );
});

test('negative: autoscript rejects hidden or offscreen targets for refs and semantic queries', async () => {
  const profileId = 'autoscript-visibility';
  const target = { ...fakePageTarget(), profileId };
  const snapshot = {
    profileId,
    targetId: target.targetId,
    documentId: 'doc-autoscript-visibility',
    url: 'https://example.test/',
    tree: { nodes: [{
      ref: 'ref:snap-autoscript-visibility:n1',
      role: 'button',
      nameText: 'Hidden action',
      visible: true,
      inViewport: false,
      stableLocator: '#hidden-action',
    }] },
  };
  snapshotRegistry.register({ snapshot: { ...snapshot, snapshotId: 'snap-autoscript-visibility' } });
  const graphPath = writeGraph(makeGraph({
    nodes: [
      makeNode({ id: 'context', operator: 'test.page_context', inputs: ['request'], output: { id: 'page_context', schema: 'Object' } }),
      makeNode({ id: 'snapshot', operator: 'test.semantic_snapshot', inputs: ['page_context'], output: { id: 'semantic_snapshot', schema: 'Object' } }),
      makeNode({ id: 'validate', operator: 'camo.container.validate', inputs: ['semantic_snapshot', 'page_context'], output: { id: 'validated_target', schema: 'Object' } }),
    ],
    edges: [
      { from: 'context', to: 'snapshot', arc_id: 'page_context' },
      { from: 'context', to: 'validate', arc_id: 'page_context' },
      { from: 'snapshot', to: 'validate', arc_id: 'semantic_snapshot' },
    ],
    outputs: ['validated_target'],
  }));
  const handlers = {
    'test.page_context': async () => target,
    'test.semantic_snapshot': async () => snapshot,
  };
  const run = (action) => runGraph({ graphPath, profileId, request: { action }, handlers });

  await assert.rejects(run({ kind: 'click', ref: 'ref:snap-autoscript-visibility:n1' }), (error) => error.code === 'E_STATE_INVALID');
  await assert.rejects(run({ kind: 'click', role: 'button' }), (error) => error.code === 'E_STATE_NOT_FOUND');
  snapshotRegistry.__resetForTest();
});

test('negative: graph node policy hook missing throws E_NODE_POLICY_MISSING before handler', async () => {
  __resetForTest();
  const graph = makeGraph({
    nodes: [
      makeNode({
        id: 'risk-node',
        operator: 'test.risk',
        inputs: ['request'],
        output: { id: 'out', schema: 'Object' },
        config: baseConfig({ riskCheckpoint: true }),
      }),
    ],
    outputs: ['out'],
  });
  const graphPath = writeGraph(graph);
  let handlerCalled = false;
  await assert.rejects(
    runGraph({
      graphPath,
      profileId: 'missing-policy',
      handlers: {
        'test.risk': async () => { handlerCalled = true; return {}; },
      },
    }),
    (err) => {
      assert.equal(err?.code, 'E_NODE_POLICY_MISSING');
      assert.equal(err?.details?.node, 'risk-node');
      assert.equal(err?.details?.hook, 'riskCheckpoint');
      return true;
    },
  );
  assert.equal(handlerCalled, false);
});

test('positive: configured policy hooks are executed with node context', async () => {
  __resetForTest();
  const calls = [];
  const graph = makeGraph({
    nodes: [
      makeNode({
        id: 'policy-node',
        operator: 'test.policy',
        inputs: ['request'],
        output: { id: 'out', schema: 'Object' },
        config: baseConfig({ preValidation: true, postValidation: true, riskCheckpoint: true }),
      }),
    ],
    outputs: ['out'],
  });
  const graphPath = writeGraph(graph);
  const out = await runGraph({
    graphPath,
    profileId: 'policies',
    handlers: {
      'test.policy': async () => {
        calls.push('handler');
        return { handled: true };
      },
    },
    options: {
      preValidation: async ({ node }) => { calls.push(`pre:${node.id}`); },
      riskCheckpoint: async ({ node }) => { calls.push(`risk:${node.id}`); },
      postValidation: async ({ output }) => { calls.push(`post:${output.handled === true}`); },
    },
  });
  assert.deepEqual(calls, ['pre:policy-node', 'risk:policy-node', 'handler', 'post:true']);
  assert.equal(out.result.handled, true);
});
