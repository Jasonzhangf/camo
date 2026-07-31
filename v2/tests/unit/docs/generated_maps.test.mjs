import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  renderMainlineCallMapHtml,
  renderMainlineCallMapMarkdown,
} from '../../../docs/wiki/function_map_view.mjs';

const callMap = JSON.parse(fs.readFileSync(
  new URL('../../../docs/mainline_call_map.json', import.meta.url),
  'utf8',
));
const functionMap = JSON.parse(fs.readFileSync(
  new URL('../../../docs/function_map.json', import.meta.url),
  'utf8',
));
const resources = JSON.parse(fs.readFileSync(
  new URL('../../../resources/registry/resources.json', import.meta.url),
  'utf8',
));

function missingBuiltinDispatches(functionTruth, callTruth) {
  const mapped = new Set(callTruth.edges
    .filter((edge) => edge.invocation?.kind === 'registry_dispatch')
    .map((edge) => `${edge.feature_id}:${edge.callee.path}:${edge.callee.symbol}`));
  return functionTruth.features
    .filter((feature) => feature.status === 'active' && feature.owner_module === 'commands.builtins')
    .flatMap((feature) => feature.entry_symbols
      .filter((entry) => entry.path !== 'v2/commands/builtins/index.mjs')
      .map((entry) => `${feature.id}:${entry.path}:${entry.symbol}`))
    .filter((signature) => !mapped.has(signature));
}

function missingResourceIndirectPaths(resourceTruth, callTruth) {
  const missing = [];
  for (const resource of resourceTruth.resources.filter((entry) => entry.status === 'active')) {
    const writes = new Set(resource.write_paths || []);
    const indirect = new Set(resource.indirect_paths || []);
    for (const edge of callTruth.edges) {
      if (!writes.has(`${edge.callee.path}::${edge.callee.symbol}`)) continue;
      const expected = `${edge.caller.path}::${edge.caller.symbol}->${edge.callee.symbol}`;
      if (!indirect.has(expected)) missing.push(`${resource.resource_id}:${expected}`);
    }
  }
  return missing;
}

test('positive: generated mainline views contain every machine call edge', () => {
  const markdown = renderMainlineCallMapMarkdown(callMap);
  const html = renderMainlineCallMapHtml(callMap);
  for (const edge of callMap.edges) {
    assert.match(markdown, new RegExp(edge.feature_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(markdown, new RegExp(edge.caller.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, new RegExp(edge.callee.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const value of [
      edge.caller.local_symbol,
      edge.callee.local_symbol,
      ...Object.values(edge.invocation || {}),
    ].filter(Boolean)) {
      const pattern = new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      assert.match(markdown, pattern);
      assert.match(html, pattern);
    }
  }
});

test('negative: changing one machine edge changes both generated projections', () => {
  const changed = structuredClone(callMap);
  changed.edges[0].semantic_io = `${changed.edges[0].semantic_io} changed`;
  assert.notEqual(renderMainlineCallMapMarkdown(changed), renderMainlineCallMapMarkdown(callMap));
  assert.notEqual(renderMainlineCallMapHtml(changed), renderMainlineCallMapHtml(callMap));
});

test('positive: every active concrete builtin has a registry-dispatch edge', () => {
  assert.deepEqual(missingBuiltinDispatches(functionMap, callMap), []);
});

test('negative: removing a concrete builtin dispatch leaves a measurable gap', () => {
  const changed = structuredClone(callMap);
  const index = changed.edges.findIndex((edge) => edge.invocation?.kind === 'registry_dispatch');
  assert.notEqual(index, -1);
  const [removed] = changed.edges.splice(index, 1);
  assert.deepEqual(missingBuiltinDispatches(functionMap, changed), [
    `${removed.feature_id}:${removed.callee.path}:${removed.callee.symbol}`,
  ]);
});

test('positive: mapped resource writes exist in resource indirect paths', () => {
  assert.deepEqual(missingResourceIndirectPaths(resources, callMap), []);
});

test('negative: removing a mapped resource write path leaves a measurable gap', () => {
  const changed = structuredClone(resources);
  const daemon = changed.resources.find((resource) => resource.resource_id === 'daemon_registration');
  const removed = 'v2/shell/daemon/index.mjs::shutdown->releaseDaemonSlot';
  daemon.indirect_paths = daemon.indirect_paths.filter((entry) => entry !== removed);
  assert.deepEqual(missingResourceIndirectPaths(changed, callMap), [
    `daemon_registration:${removed}`,
  ]);
});
