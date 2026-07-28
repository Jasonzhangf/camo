# shell/doctor (stage 5a wired)

Layer: L5_shell. Owner module id registered in `v2/resources/registry/modules.json`.

`check.mjs` returns a structured report (read-only). The CLI invocation
`camo doctor` prints it as JSON.

The report covers:
- node version
- protocol version
- registry command count, docstring count, test count
- v1 leftover count (informational; the CI gate is the source of truth)
- CI mode (strict when CAMO_V2_STRICT=1, non-strict otherwise)
