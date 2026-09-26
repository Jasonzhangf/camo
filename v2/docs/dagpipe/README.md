# camo runtime DAG

Single SESE object flow for browser-runtime capabilities inside camo. The graph
does not contain webauto/XHS/Weibo business logic; application callers own their
own DAGs outside this repository boundary.

`compiled_runner.mjs` treats node config flags as required policy hooks:
`preValidation`, `postValidation`, and `riskCheckpoint`. When a node sets one
of those flags to `true`, the caller must pass the matching hook through
`runGraph({ options })`; a missing hook fails with `E_NODE_POLICY_MISSING`
instead of silently becoming a sleep/no-op.
