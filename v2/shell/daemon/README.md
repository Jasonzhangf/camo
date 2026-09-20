# shell.daemon

Owns the shared daemon process and the external command boundary.

## Entry point

- `index.mjs` starts the HTTP/WS servers, maintains daemon registration, and
  handles idle reclamation and shutdown.
- `command_handlers.mjs` resolves external `--target` values through
  `services/browser_service` before dispatching page operations.
- `browser_commands.mjs` is the shared command classification used by both
  daemon dispatch and CLI autostart.

## Target boundary

The daemon accepts `target` as the external page handle. It resolves the target
through the session owner and passes only the internal page handle to page
runtime. It does not use current, foreground, newest, or array-index page
selection. Stale, cross-profile, unknown, and ambiguous targets fail with typed
errors.

## Lifecycle and status

Ordinary browser commands auto-discover an active daemon or start one when
needed. `status` is the exception: with no daemon it returns
`service.state: unavailable` without starting anything; with a daemon it reads
the session, target, execution, and reclamation projections without touching
idle time, progress, browser state, or process state.

Temporary profile data is deleted only after the browser session closes.
Cleanup failures remain explicit pending cleanup entries in `status`.
