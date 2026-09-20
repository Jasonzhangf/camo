# camo list-tabs

List active targets and their stable page bindings.

## Usage

```
camo list-tabs [--target <t_id>] [--profile <id>]
```

Each row contains `target`, `page`, `url`, and `title`. `--target` filters the
projection to one stable target; omitting it lists every active target for the
profile.

## Wiring

- CLI: `commands/builtins/list-tabs.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires at least one active target (`camo start` first).
- Returns stable target/page ids; array order is presentation only.
- No fallback; first failure is reported.
