import test from 'node:test';
import assert from 'node:assert/strict';
import * as runner from '../../../services/autoscript/runner.mjs';
import * as compiled from '../../../services/autoscript/compiled_runner.mjs';

test('runner exposes only canonical graph validation and execution', () => {
  assert.deepEqual(Object.keys(runner).sort(), ['runCompiledGraph', 'runGraph', 'validateGraph']);
  assert.equal(runner.runGraph, compiled.runGraph);
  assert.equal(runner.runCompiledGraph, compiled.runGraph);
  assert.equal(runner.validateGraph, compiled.validateGraph);
});

test('invalid graph never enters page handlers through public runner', async () => {
  let called = false;
  await assert.rejects(runner.runGraph({
    graphPath: '/nonexistent/camo-graph.json',
    options: { beforeExecution: () => { called = true; } },
  }), error => error.code === 'E_GRAPH_INVALID' && error.terminal === 'graph_invalid');
  assert.equal(called, false);
});
