# camo v2

This directory holds the v2 runtime of camo. The resource registry is the
machine truth for resource ownership, read/write paths, verification gates, and
module edges. `../src/` is retained only as legacy material and is not the v2
execution path.

## Read order (top-down)

1. `v2/resources/registry/`        resource map, module map, edge map, policies
2. `v2/docs/wiki/architecture.html` human mirror of registry
3. `v2/docs/wiki/resources.html`    per-resource narrative (built from JSON)
4. `v2/docs/migration_contracts/mainline_call_map.md` per-edge narrative
5. `v2/docs/verification/`          per-gate narrative
6. `v2/gates/run-all.mjs`           gate runner

## Current target contract

Browser actions use the stable `target` returned by `camo start`, `camo
new-tab`, or `camo multi-open`. The daemon resolves that external handle
through the session owner and passes an internal page handle to page runtime.
It never substitutes the current page, foreground page, newest page, or array
index for an explicit target.

`camo status` is a read-only projection. With no daemon it reports
`service.state: unavailable`; with a daemon it reports sessions, targets,
execution, and reclamation without refreshing idle time or changing browser
state.

## Run gates locally

    node v2/gates/run-all.mjs           # registry integrity; per-resource reported as info
    node v2/gates/run-all.mjs --strict  # any per-resource FAIL is fatal

## Build wiki from registry

    cd v2/docs/wiki && ./build.sh

## Registry and verification

The registry contains active v2 resources and their verification gates.
`browser_target` is owned by `services/session` and its gate is
`registry.resources.browser_target`.

## Legacy v1 leftovers

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

These paths are legacy references used by the per-resource gates. They are not
the v2 execution path.

## CI wiring (hard guard 22a: required)

Add to `.github/workflows/ci.yml`:

```yaml
- name: v2 registry gates
  run: node v2/gates/run-all.mjs
```

The workflow must run this command; otherwise the registry gates are not CI
gates.
