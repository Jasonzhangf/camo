# shell/bin_entry

Layer: `L5_shell`. `index.mjs` is the process entry invoked by `bin/camo` and
`bin/camo.mjs`.

It validates argv, performs the Camoufox readiness check for browser commands,
discovers an active daemon, and opens the WS transport. Ordinary browser
commands auto-start the shared daemon when none is active; `camo start` uses
the same autostart path and returns the allocated `target`.

`status` is read-only at this layer too: when no daemon is active it prints an
`unavailable` projection and exits successfully without spawning a daemon.

Hard guards:
- one argv entry; no side effects on import;
- no fake transport fallback;
- typed errors are projected through `error_envelope/projector.mjs`.
