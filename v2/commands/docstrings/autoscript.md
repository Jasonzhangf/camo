# camo autoscript

Run a DAGpipe validated camo runtime graph through the daemon.

```
camo autoscript run --graph <graph.json> --run-id <id> --profile <profile> --target <target> --action-json '<json object>'
```

- The graph must pass `dagpipe graph validate` before any graph handler runs.
- `--action-json` supplies the generic action object consumed by the graph.
- Runs sharing a profile execute serially.
- The result contains `ok`, `graphId`, `graphVersion`, `validation`, `plan`, and `result`.

This command provides runtime execution only. Application specific graph policy
and orchestration belong to the caller.
