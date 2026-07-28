# shell/bin_entry (stage 5a wired)

Layer: L5_shell. Owner module id registered in `v2/resources/registry/modules.json`.

`index.mjs` is the process entry invoked by the top-level `bin/camo`
shell wrapper. argv flows into `cli/dispatch.mjs::dispatch`, the
result/error is printed, and the process exits with code 0/2/3.

Hard guards:
- One argv entry; no side effects on import.
- Errors projected to wire format via `error_envelope/projector.mjs`.
