# commands/registry (stage 4a wired)

Layer: L4_command. Owner module id registered in `v2/resources/registry/modules.json`.

`registry.json` is the single source of truth for cmd_id metadata. The
companion `registry.mjs` reads it, freezes the table, and rejects
unknown cmd_ids at `look()` time with `E_PROTO_NO_HANDLER`.

Hard guards:
- One entry per cmd; no duplicates (enforced at load).
- `cmd`, `module`, `args_schema`, `docstring` are required fields.
