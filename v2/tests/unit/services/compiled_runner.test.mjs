import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGraph, __resetForTest } from '../../../services/autoscript/compiled_runner.mjs';
import * as inboundPipeline from '../../../services/page_runtime/input_pipeline.mjs';
import * as progressLog from '../../../services/progress_event/log.mjs';

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
  await assert.rejects(
    runGraph({
      graphPath,
      profileId: 'invalid-cycle',
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
