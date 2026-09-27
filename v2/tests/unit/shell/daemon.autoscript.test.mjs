import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleCommand } from '../../../shell/daemon/command_handlers.mjs';

test('autoscript validates graph before daemon can touch browser runtime', async () => {
  const graphPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-autoscript-')), 'invalid.json');
  fs.writeFileSync(graphPath, JSON.stringify({ id: 'invalid', version: '1', inputs: [], nodes: [], edges: [], outputs: [] }));
  let browserTouched = false;
  await assert.rejects(
    handleCommand('autoscript', {
      subcommand: 'run', graphPath, runId: 'invalid-run', profile: 'autoscript-invalid',
      target: 'target-1', action: { kind: 'click' },
    }, {
      profile: 'autoscript-invalid', opts: {},
      ensureBrowser: async () => { browserTouched = true; },
      ephemeralAllocations: new Map(),
    }),
    (error) => error.code === 'E_GRAPH_INVALID',
  );
  assert.equal(browserTouched, false);
});

test('autoscript resolves the requested target before ensuring a browser session', async () => {
  const graphPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'camo-daemon-autoscript-policy-')), 'graph.json');
  fs.writeFileSync(graphPath, JSON.stringify({
    id: 'autoscript-policy-check',
    version: '1',
    inputs: [{ id: 'request', schema: 'Object' }],
    nodes: [{
      id: 'validate_target',
      operator: 'camo.container.validate',
      operator_version: '1',
      inputs: ['request'],
      output: { id: 'validated_target', schema: 'Object' },
      input_selector: { include: [], exclude: [], predicate: null },
      output_selector: { include: [], exclude: [], predicate: null },
      iterator: 'Whole',
      config: { pacingMs: 0, jitterMs: 0, preValidation: false, postValidation: false, riskCheckpoint: true },
    }],
    edges: [],
    outputs: ['validated_target'],
  }));
  let browserTouched = false;
  await assert.rejects(
    handleCommand('autoscript', {
      subcommand: 'run', graphPath, runId: 'missing-target-arc', profile: 'autoscript-policy',
      target: 't_target1', action: { kind: 'click', role: 'button' },
    }, {
      profile: 'autoscript-policy', opts: {},
      ensureBrowser: async () => { browserTouched = true; },
      ephemeralAllocations: new Map(),
    }),
    (error) => error.code === 'E_STATE_NOT_FOUND',
  );
  assert.equal(browserTouched, false);
});
