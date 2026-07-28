# shell/cli (stage 5a wired)

Layer: L5_shell. Owner module id registered in `v2/resources/registry/modules.json`.

`dispatch.mjs` is the only argv parser entry point. It pulls together:
- `commands/parsers/flags.mjs` (single source of arg parsing)
- `commands/registry/registry.mjs` (single source of cmd metadata)
- `commands/builtins/index.mjs` (single source of builtin dispatch)
- `transports/client/api.mjs` (single wire surface)

Hard guards:
- No service imports (forbidden edge per registry edges.json).
- No business helpers here; only arg flow.

## Help

```
camo --help
camo help
camo <cmd> --help
```

## Doctor

```
camo doctor
```
