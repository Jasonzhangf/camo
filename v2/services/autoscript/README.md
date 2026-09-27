# Autoscript runtime

`runner.mjs` exports the graph-consuming API owned by `compiled_runner.mjs`.
`runGraph` validates the SESE graph with `dagpipe graph validate` before any
page-layer operation. It owns execution order and per-profile serialization;
there is no separate legacy state machine or action-provider registry.

Failure terminals are expressed by the runtime error envelope (`code`,
`terminal`, `message`, optional `details`), never by graph nodes or output ARCs.
The graph retains exactly one output ARC for successful results.

| Error code | Runtime terminal | Trigger |
| --- | --- | --- |
| `E_GRAPH_INVALID` | `graph_invalid` | Graph validation/compilation fails before execution |
| `E_RISK_BLOCKED` | `risk_blocked` | Risk checkpoint returns `false` or throws an unclassified failure |
| `E_IO_TIMEOUT` | `operation_timeout` | Input pipeline operation times out |
| `E_LOGIN_INVALID` | `login_invalid` | Caller-owned login validation throws this typed error |

Policy hooks are required when enabled in node config. A missing hook returns
`E_NODE_POLICY_MISSING`. Risk hooks may return normally to allow execution;
already typed terminal errors are preserved, including `E_LOGIN_INVALID`.
Login/platform detection belongs to the caller, not camo business logic.
Errors reject `runGraph`; no subsequent node executes and no success result is
produced. `CamoError` and its wire projection retain the same terminal.

Semantic snapshots probe DOM+ARIA APIs inside the page binding and report
`capabilities: { semantic: 'dom-aria', nativeAccessibility: false }`.
This is inferred semantics, not Ego Lite's native accessibility snapshot.
An absent/unstable semantic surface returns `E_SNAPSHOT_CAPABILITY_MISSING`;
raw HTML is available only through explicit `rawDom`, with no screenshot fallback.
