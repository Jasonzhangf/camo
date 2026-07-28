# v2 rebuild plan

Status: rebuilding from `v2/resources/registry/` truth.

## Stages (each ends only when gate green)

| Stage | Scope | Output | Gate |
|-------|-------|--------|------|
| 2a | contracts/error_envelope codes + projector | codes.json, projector.mjs | unit + red paths |
| 2b | services/profile store | store.mjs | unit + dual-read with v1 |
| 2c | services/session manager | manager.mjs | unit |
| 2d | services/lock manager | manager.mjs | unit + SIGTERM escape |
| 2e | services/progress_event log | log.mjs | unit |
| 2f | services/command_log log | log.mjs | unit |
| 2g | services/display resolver | resolver.mjs | unit + env override |
| 2h | services/container matcher | matcher.mjs | unit |
| 2i | services/subscription registry | registry.mjs | unit |
| 2j | services/page_runtime tab_pool + input_pipeline | both modules | unit |
| 2k | services/autoscript runner + actions/<id> | runner + 4 sample actions | unit + schema |
| 2l | services/browser_service process | bootstrap that owns services above | unit |
| 3a | contracts/{ws,http}_messages | type-lock schemas + builders/parsers | unit |
| 3b | transports/{ws,http,client,daemon} | thin transports | unit |
| 4a | commands/registry + parsers + docstrings | registry.json, infer/parse rules | unit |
| 4b | commands/builtins/<id>.mjs (subset) | start/stop/goto/click/type | unit + WS roundtrip |
| 5a | shell/cli + shell/doctor + bin_entry | bin entry that mirrors `camo` + `browser-service` | smoke |
| 6  | remove v1 leftovers (one by one, per green gate) | each removal bumps registry status | per-resource gate green |

## Hard rules

- One truth_owner per resource (registry gate enforces)
- Tests live next to owner; required-tests recorded in feature_tests.json
- No fallback, no shortcut (hard guard 3)
- Migration commits gated by green CI (hard guard 22a)
- Review required before sign-off (hard guard 36)
- Status flips tied to deletion of v1 shadow + gate green
