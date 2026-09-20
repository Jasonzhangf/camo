# camo close-tab

Close the page bound to a stable target.

## Usage

```
camo close-tab --target <t_id> [--profile <id>]
```

The result returns both the stable `target` and its bound `page` id. Closing
the page and deleting temporary profile data are separate lifecycle steps;
`close-tab` never deletes the profile.

## Wiring

- CLI: `commands/builtins/close-tab.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active target (`camo start` first).
- `--target` is required; tab indices are not accepted.
- A stale or cross-profile target fails explicitly.
- No fallback; first failure is reported.
