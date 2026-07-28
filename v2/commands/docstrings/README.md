# commands/docstrings (stage 4a wired)

Layer: L4_command. Owner module id registered in `v2/resources/registry/modules.json`.

Each command in `commands/registry/registry.json` references exactly one
markdown file here. The docstring is what `camo <cmd> --help` prints.

Hard guards:
- Docstring file basename must equal `cmd`. The `docstring` field in
  `registry.json` is read-only.
- No code in this directory.
