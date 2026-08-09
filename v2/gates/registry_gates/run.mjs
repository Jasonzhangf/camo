#!/usr/bin/env node
// Registry gate runner. v2/resources/registry/* truth check.
// CI must invoke this (hard guard 22a).

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const V2_ROOT = path.resolve(__dirname, '..', '..'); // v2/
const REG_DIR = path.join(V2_ROOT, 'resources', 'registry');

const PALETTE = { fail: '\u001b[31mFAIL\u001b[0m', pass: '\u001b[32mPASS\u001b[0m', warn: '\u001b[33mWARN\u001b[0m' };
let failed = 0;

function pass(name) { console.log(`[${PALETTE.pass}] ${name}`); }
function fail(name, message) { console.error(`[${PALETTE.fail}] ${name}: ${message}`); failed += 1; }
function warn(name, message) { console.log(`[${PALETTE.warn}] ${name}: ${message}`); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function ok(name) { pass(name); }

const resources = readJson(path.join(REG_DIR, 'resources.json'));
const modules = readJson(path.join(REG_DIR, 'modules.json'));
const edges = readJson(path.join(REG_DIR, 'edges.json'));
const policies = readJson(path.join(REG_DIR, 'policies.json'));

// Resolve truth_owner to a declared module id. Try longest path first.
function ownerToModuleId(owner) {
  const parts = owner.replace(/^v2\//, '').split('/');
  for (let n = parts.length; n > 0; n -= 1) {
    const candidate = parts.slice(0, n).join('.');
    if (modules.modules.some((m) => m.id === candidate)) return candidate;
  }
  return parts.join('.');
}

function groupIds() {
  const ids = new Set(modules.modules.map((m) => m.id));
  for (const l of resources.layers) ids.add(l.id);
  return ids;
}

function stripV2Prefix(p) { return p.replace(/^v2\//, ''); }

// Gate 1
{
  const ids = resources.resources.map((r) => r.resource_id);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dups.length === 0) ok('registry.resources.unique_ids');
  else fail('registry.resources.unique_ids', `dup: ${[...new Set(dups)].join(', ')}`);
}

// Gate 2
{
  const moduleIds = new Set(modules.modules.map((m) => m.id));
  const unknown = [];
  for (const r of resources.resources) {
    const mid = ownerToModuleId(r.truth_owner);
    if (!moduleIds.has(mid)) unknown.push(`${r.resource_id}->${r.truth_owner}(resolved=${mid})`);
  }
  if (unknown.length === 0) ok('registry.resources.owners_declared');
  else fail('registry.resources.owners_declared', `unknown: ${unknown.join(', ')}`);
}

// Gate 3
{
  const bad = [];
  for (const r of resources.resources) {
    const mid = ownerToModuleId(r.truth_owner);
    const mod = modules.modules.find((m) => m.id === mid);
    if (mod && mod.layer !== r.layer) bad.push(`${r.resource_id}:layer=${r.layer} owner=${mid}(${mod.layer})`);
  }
  if (bad.length === 0) ok('registry.resources.layer_match');
  else fail('registry.resources.layer_match', bad.join('; '));
}

// Gate 4
{
  const idx = new Map(resources.layers.map((l, i) => [l.id, i]));
  const bad = [];
  for (const l of resources.layers) for (const dep of l.depends_on) {
    if (!idx.has(dep)) bad.push(`unknown dep ${dep} in ${l.id}`);
    else if (idx.get(dep) >= idx.get(l.id)) bad.push(`${l.id} depends on same/higher ${dep}`);
  }
  if (bad.length === 0) ok('registry.layers.acyclic_lower_only');
  else fail('registry.layers.acyclic_lower_only', bad.join('; '));
}

// Gate 5
{
  const ids = groupIds();
  const bad = [];
  for (const e of edges.edges) {
    if (!ids.has(e.from)) bad.push(`unknown from=${e.from}`);
    if (!ids.has(e.to)) bad.push(`unknown to=${e.to}`);
  }
  if (bad.length === 0) ok('registry.edges.modules_declared');
  else fail('registry.edges.modules_declared', bad.join('; '));
}

// Gate 6
{
  const e = new Set(edges.edges.map((x) => `${x.from}->${x.to}`));
  const f = new Set(edges.forbidden_edges.map((x) => `${x.from}->${x.to}`));
  const ov = [...f].filter((s) => e.has(s));
  if (ov.length === 0) ok('registry.edges.no_forbidden_overlap');
  else fail('registry.edges.no_forbidden_overlap', ov.join(', '));
}

// Gate 7
{
  const pids = new Set(policies.policies.map((p) => p.id));
  const unk = [];
  for (const r of resources.resources) if (!pids.has(r.policy_id)) unk.push(`${r.resource_id}->${r.policy_id}`);
  if (unk.length === 0) ok('registry.resources.policies_declared');
  else fail('registry.resources.policies_declared', unk.join(', '));
}

// Gate 8
{
  const seen = new Set();
  const dups = [];
  for (const r of resources.resources) for (const p of r.forbidden_paths) {
    if (seen.has(p)) dups.push(`${r.resource_id}:${p}`);
    seen.add(p);
  }
  if (dups.length === 0) ok('registry.resources.forbidden_paths_unique');
  else fail('registry.resources.forbidden_paths_unique', dups.join(', '));
}

// Gate 9: probe each module's first owned path. Directory globs require a
// README; exact machine paths must exist as files.
{
  const missing = [];
  for (const m of modules.modules) {
    const owned = m.owned_paths[0];
    const isDirectoryGlob = owned.endsWith('/**');
    const root = owned.replace(/\/\*\*$/, '');
    const inside = stripV2Prefix(root);
    const probe = path.join(V2_ROOT, inside, isDirectoryGlob ? 'README.md' : '');
    if (!fs.existsSync(probe)) missing.push(`${m.id} (no ${path.relative(V2_ROOT, probe)})`);
  }
  if (missing.length === 0) ok('registry.modules.probe_files_exist');
  else fail('registry.modules.probe_files_exist', missing.join('; '));
}

// Gate 10
{
  const missing = [];
  for (const r of resources.resources) {
    const sp = path.join(__dirname, 'gates', `${r.verification_gate}.mjs`);
    if (!fs.existsSync(sp)) missing.push(`${r.verification_gate}`);
  }
  if (missing.length === 0) ok('registry.resources.gates_resolvable');
  else warn('registry.resources.gates_resolvable', `${missing.length} resource-level gates pending (expected while status=design)`);
}

console.log('');
if (failed === 0) {
  console.log(`[${PALETTE.pass}] registry gates: 0 failed`);
  process.exit(0);
} else {
  console.error(`[${PALETTE.fail}] registry gates: ${failed} failed`);
  process.exit(1);
}
