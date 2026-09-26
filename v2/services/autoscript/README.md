# services-autoscript (design)

Module owner placeholder. Real implementation will live in this directory.
See `v2/resources/registry/modules.json` for the canonical id.

The production execution path is `compiled_runner.mjs`: it validates a SESE
camo graph with `dagpipe graph validate` before any page-layer work. Invalid
graphs return `E_GRAPH_INVALID` and never reach handlers. `runner.mjs` keeps
legacy unit surface for the existing transition tests, while `runGraph` is the
graph-consuming entry point used by current consumers.

Layer: see modules.json.

Skeletons to land here before this module becomes active:
- `manager.mjs` (or equivalent) with single owner of the resource(s) listed in resources.json.
- One thin `index.mjs` re-exporting public surface.
- Tests under `v2/tests/unit/<path>/`.
