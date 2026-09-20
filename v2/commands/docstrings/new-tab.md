# camo new-tab

Create a page in the browser context and allocate a new stable target.

## Usage

```
camo new-tab [--url <https://...>] [--target <t_id>] [--profile <id>]
```

`--target` identifies the existing browser context to use when the profile has
multiple targets. The result contains the newly allocated `target` and `page`.

## Wiring

- CLI: `commands/builtins/new-tab.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session (`camo start` first).
- The new page is addressed by its returned stable target, never by array index.
- No fallback; first failure is reported.
