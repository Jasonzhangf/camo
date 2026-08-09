import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
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
const modules = JSON.parse(fs.readFileSync(
  new URL('../../../resources/registry/modules.json', import.meta.url),
  'utf8',
));
const registryEdges = JSON.parse(fs.readFileSync(
  new URL('../../../resources/registry/edges.json', import.meta.url),
  'utf8',
));
const V2_ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['dist', 'node_modules', 'tests'].includes(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(?:mjs|js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(absolute);
  }
  return files;
}

function governedSourceFiles() {
  return sourceFiles(V2_ROOT).filter((file) => {
    const relative = path.relative(V2_ROOT, file).split(path.sep).join('/');
    return relative.startsWith('commands/')
      || relative.startsWith('contracts/')
      || relative.startsWith('protocol/')
      || relative.startsWith('runtime/page_scripts/')
      || relative.startsWith('services/')
      || relative.startsWith('shell/bin_entry/')
      || relative.startsWith('shell/cli/')
      || relative.startsWith('shell/config/')
      || relative.startsWith('shell/daemon/')
      || relative.startsWith('shell/doctor/')
      || relative.startsWith('transports/');
  });
}

function matchOwnedPath(relativePath, pattern) {
  const normalized = pattern.replace(/^v2\//, '');
  if (normalized.endsWith('/**')) return relativePath.startsWith(normalized.slice(0, -3) + '/');
  return relativePath === normalized;
}

function owningModules(relativePath) {
  return modules.modules
    .filter((module) => module.status === 'active')
    .filter((module) => module.owned_paths.some((pattern) => matchOwnedPath(relativePath, pattern)))
    .map((module) => module.id);
}

function importEdges() {
  const edges = [];
  for (const absolute of governedSourceFiles()) {
    const relative = path.relative(V2_ROOT, absolute).split(path.sep).join('/');
    const fromOwners = owningModules(relative);
    if (fromOwners.length !== 1) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportAllDeclaration') continue;
      const specifier = node.source?.value;
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(absolute), specifier);
      if (!target.startsWith(V2_ROOT + path.sep)) continue;
      const targetRelative = path.relative(V2_ROOT, target).split(path.sep).join('/');
      const toOwners = owningModules(targetRelative);
      if (toOwners.length !== 1 || toOwners[0] === fromOwners[0]) continue;
      edges.push(`${fromOwners[0]}->${toOwners[0]}`);
    }
  }
  return [...new Set(edges)].sort();
}

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

test('positive: every active source file has exactly one module owner', () => {
  const bad = governedSourceFiles()
    .map((file) => path.relative(V2_ROOT, file).split(path.sep).join('/'))
    .map((file) => ({ file, owners: owningModules(file) }))
    .filter(({ owners }) => owners.length !== 1);
  assert.deepEqual(bad, []);
});

test('positive: real static import edges are declared by the edge registry', () => {
  const declared = new Set(registryEdges.edges.map((edge) => `${edge.from}->${edge.to}`));
  assert.deepEqual(importEdges().filter((edge) => !declared.has(edge)), []);
});
