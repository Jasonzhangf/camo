// camo v2 doctor. Module id=shell.doctor.
//
// Read-only sanity check that summarises:
//   - node version
//   - registry integrity (counts; does not run gates, that's CI's job)
//   - v1 leftover count (informational only at non-strict stage)
//   - protocols version
//
// Returns a structured report. The CLI printer is in shell/cli/dispatch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list as registryList } from '../../commands/registry/registry.mjs';
import { VERSION } from '../../protocol/versions/v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2_ROOT = path.resolve(__dirname, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function safeCount(dir, ext) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(ext)).length;
  } catch { return 0; }
}

function v1Leftovers() {
  // Tally of files under src/ that the per-resource gates report as
  // forbidden shadow copies. Informational; the actual gate runs in CI.
  const resources = readJson(path.join(V2_ROOT, 'resources', 'registry', 'resources.json')).resources;
  const mapping = {
    'v2/lifecycle/session_registry.mjs': 'src/lifecycle/session-registry.mjs',
    'v2/lifecycle/lock.mjs': 'src/lifecycle/lock.mjs',
    'v2/services/browser_service/internal/container_matcher.js': 'src/services/browser-service/internal/container-matcher.js',
    'v2/services/browser_service/internal/page_runtime/runtime.js': 'src/services/browser-service/internal/page-runtime/runtime.js',
    'v2/services/browser_service/internal/engine_manager.js': 'src/services/browser-service/internal/engine-manager.js',
    'v2/services/browser_service/internal/process_cleanup.js': 'src/services/browser-service/internal/process-cleanup.js',
    'v2/services/browser_service/internal/browser_session/input_ops.js': 'src/services/browser-service/internal/browser-session/input-ops.js',
    'v2/services/browser_service/index.js': 'src/services/browser-service/index.js',
    'v2/core/actions.mjs': 'src/core/actions.mjs',
    'v2/autoscript/action_providers/index.mjs': 'src/autoscript/action-providers/index.mjs',
    'v2/container/runtime_core/search.mjs': 'src/container/runtime-core/search.mjs',
    'v2/container/subscription_registry.mjs': 'src/container/subscription-registry.mjs',
    'v2/operations/tab_pool.mjs': 'src/container/runtime-core/operations/tab-pool.mjs',
  };
  const repoRoot = path.resolve(V2_ROOT, '..');
  const leftovers = [];
  for (const r of resources) {
    for (const fp of r.forbidden_paths || []) {
      const bare = fp.split('::')[0];
      const shadow = mapping[bare];
      if (shadow) {
        const abs = path.join(repoRoot, shadow);
        if (fs.existsSync(abs)) leftovers.push({ resource: r.resource_id, path: shadow });
      }
    }
  }
  return leftovers;
}

function countTestFiles() {
  const dir = path.join(V2_ROOT, 'tests', 'unit');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile && e.isFile() && e.name.endsWith('.test.mjs')).length;
}

function countDocstrings() {
  const dir = path.join(V2_ROOT, 'commands', 'docstrings');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').length;
}

export function run() {
  const report = {
    node: process.version,
    protocol: VERSION,
    registry: {
      commands: registryList().length,
      docstrings: countDocstrings(),
      tests: countTestFiles(),
    },
    v1_leftovers: v1Leftovers(),
    generated_at: new Date().toISOString(),
  };
  // Stamp the registry status as the canonical CI mode.
  // Strict-mode CI flips this to 'wiring-complete' automatically.
  report.ci_mode = process.env.CAMO_V2_STRICT === '1' ? 'strict' : 'non-strict';
  return report;
}

export function describe() {
  return {
    moduleId: 'shell.doctor',
    layer: 'L5_shell',
    role: 'environment sanity checks',
  };
}
