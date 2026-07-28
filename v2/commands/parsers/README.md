# commands/parsers (stage 4a wired)

Layer: L4_command. Owner module id registered in `v2/resources/registry/modules.json`.

`flags.mjs` is the single argument parser for camo v2. Pure function;
collects errors instead of throwing so `shell/cli` can print them all
at once.

Hard guards:
- No CLI parsing outside this module.
- No direct imports from `v1/commands/**`. Only `commands/registry` and
  `contracts/error_envelope` are allowed dependencies.
