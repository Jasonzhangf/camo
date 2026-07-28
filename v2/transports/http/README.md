# transports/http (stage 3b wired)

Layer: L3_transport. Owner module id registered in `v2/resources/registry/modules.json`.

This directory owns the boundary between the contracts (L1) builders/
parsers and the browser-service process. No business semantics here —
just wire IO that fails loud and explicit.

Hard guards:
- No raw JSON on the wire; always `build`/`parse` via envelope modules.
- Every error path projects via `error_envelope/projector.mjs` and
  is wrapped in a v1 envelope so the consumer sees a stable shape.
- Test seams: `__enableTestRoot()` + `__resetForTest()`.

See also:
- `v2/contracts/ws_messages/v1/envelope.mjs` (L1)
- `v2/contracts/http_messages/v1/envelope.mjs` (L1)
- `v2/transports/daemon/dispatch.mjs` (daemon wiring, stage 5)
