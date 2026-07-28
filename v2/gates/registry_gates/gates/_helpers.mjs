// Shared helpers for per-resource gates.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
export const V1_ROOT = path.resolve(__dirname, '..', '..', '..', '..');  // repo root (camo)
export const V2_ROOT = path.resolve(__dirname, '..', '..', '..');          // v2/

export const PALETTE = {
  fail: '\u001b[31mFAIL\u001b[0m',
  pass: '\u001b[32mPASS\u001b[0m',
  warn: '\u001b[33mWARN\u001b[0m',
};

export function readRegistry() {
  const dir = path.join(V2_ROOT, 'resources', 'registry');
  return {
    resources: JSON.parse(fs.readFileSync(path.join(dir, 'resources.json'), 'utf8')),
    modules:   JSON.parse(fs.readFileSync(path.join(dir, 'modules.json'), 'utf8')),
  };
}

export function getResource(resource_id) {
  const { resources } = readRegistry();
  const r = resources.resources.find((x) => x.resource_id === resource_id);
  if (!r) throw new Error(`resource ${resource_id} missing from registry`);
  return r;
}

// Returns array of absolute v1 paths that shadow this forbidden path.
// Each `forbidden_path` may contain a `::verb` suffix or `**` glob that
// we strip before lookup. Returns null entries for entries we cannot
// resolve to a single v1 file (e.g. category globs).
export function v1Shadows(forbiddenPath) {
  const bare = forbiddenPath.split('::')[0]; // drop ::verb suffix
  const mapping = {
    'v2/lifecycle/session_registry.mjs':                  'src/lifecycle/session-registry.mjs',
    'v2/lifecycle/lock.mjs':                              'src/lifecycle/lock.mjs',
    'v2/services/browser_service/internal/container_matcher.js': 'src/services/browser-service/internal/container-matcher.js',
    'v2/services/browser_service/internal/page_runtime/runtime.js': 'src/services/browser-service/internal/page-runtime/runtime.js',
    'v2/services/browser_service/internal/engine_manager.js': 'src/services/browser-service/internal/engine-manager.js',
    'v2/services/browser_service/internal/process_cleanup.js': 'src/services/browser-service/internal/process-cleanup.js',
    'v2/services/browser_service/internal/browser_session/input_ops.js': 'src/services/browser-service/internal/browser-session/input-ops.js',
    'v2/services/browser_service/index.js': 'src/services/browser-service/index.js',
    'v2/core/actions.mjs':                                'src/core/actions.mjs',
    'v2/autoscript/action_providers/index.mjs':           'src/autoscript/action-providers/index.mjs',
    'v2/container/runtime_core/search.mjs':               'src/container/runtime-core/search.mjs',
    'v2/container/subscription_registry.mjs':             'src/container/subscription-registry.mjs',
    'v2/operations/tab_pool.mjs':                         'src/container/runtime-core/operations/tab-pool.mjs',
  };
  const v1 = mapping[bare];
  if (v1) return [path.join(V1_ROOT, v1)];
  return [];
}

export function checkForbiddenGone(resource_id) {
  const r = getResource(resource_id);
  const hits = [];
  for (const fp of r.forbidden_paths) {
    for (const shadow of v1Shadows(fp)) {
      if (fs.existsSync(shadow)) hits.push(path.relative(V1_ROOT, shadow));
    }
  }
  return { ok: hits.length === 0, hits, resource: r };
}
