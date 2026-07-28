# camo v2 (in-design)

This directory holds the v2 rebuild of camo. v2 is rebuilt clean from
zero using the resource registry as the machine truth. v1 lives in
`../src/` and is not modified by the v2 work.

## Read order (top-down)

1. `v2/resources/registry/`        resource map, module map, edge map, policies
2. `v2/docs/wiki/architecture.html` human mirror of registry
3. `v2/docs/wiki/resources.html`    per-resource narrative (built from JSON)
4. `v2/docs/migration_contracts/mainline_call_map.md` per-edge narrative
5. `v2/docs/verification/`          per-gate narrative
6. `v2/gates/run-all.mjs`           gate runner

## Status

Every entry in `v2/resources/registry/*` is currently `design`. No
production path may cite a design entry as live truth (hard guard 22b).

A resource flips to `active` after:

1. The owning module file is wired.
2. `forbidden_paths` are physically absent from `../src/`.
3. The corresponding gate runs green in CI.

## Run gates locally

    node v2/gates/run-all.mjs           # registry integrity; per-resource reported as info
    node v2/gates/run-all.mjs --strict  # any per-resource FAIL is fatal

## Build wiki from registry

    cd v2/docs/wiki && ./build.sh

## Forbidden v1 leftovers

| v1 file | blocks resource |
|---|---|
| `src/lifecycle/session-registry.mjs` | browser_session |
| `src/lifecycle/lock.mjs` | profile_lock |
| `src/services/browser-service/internal/container-matcher.js` | container_match |
| `src/container/runtime-core/search.mjs` | container_match |
| `src/services/browser-service/internal/engine-manager.js` | display_metrics |
| `src/services/browser-service/internal/process-cleanup.js` | display_metrics |
| `src/services/browser-service/index.js` (display-metrics block) | display_metrics |
| `src/services/browser-service/internal/browser-session/input-ops.js` | input_pipeline |
| `src/core/actions.mjs` | input_pipeline |
| `src/autoscript/action-providers/index.mjs` | autoscript_action |
| `src/services/browser-service/internal/page-runtime/runtime.js` | page_runtime |
| `src/container/subscription-registry.mjs` | subscription |
| `src/container/runtime-core/operations/tab-pool.mjs` | tab_pool |

These are exactly what the per-resource gates already detect; their
output is the spec for what to remove in v1 to enable activation.

## CI wiring (hard guard 22a: required)

Add to `.github/workflows/ci.yml`:

```yaml
- name: v2 registry gates
  run: node v2/gates/run-all.mjs
```

Until that line exists in CI, the gates are not gates.
