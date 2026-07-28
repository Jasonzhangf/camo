# commands/builtins (stage 4b wired)

Layer: L4_command. Owner module id registered in `v2/resources/registry/modules.json`.

Five builtin commands. Each is a thin orchestrator that takes
`(transport, parsed, ctx)` and uses `transports/client/api.mjs` to
dispatch a single `{cmd, args}` payload. The browser-service process is
where the actual semantic action lives.

Each builtin:
- Validates `profile` against `[a-zA-Z0-9._-]+` (parser does it earlier).
- Returns a plain payload — no envelope construction here. The shell
  layer adds the v1 envelope via `transports/ws` or `transports/http`.

Available builtins:
- `start.mjs`  — boot a session for the given profile.
- `stop.mjs`   — release the session + lock.
- `goto.mjs`   — navigate to an http(s) URL.
- `click.mjs`  — enforce exactly-one-of `--selector` / `--text`.
- `type.mjs`   — type text into focused element or specified selector.
