# services-browser_service

Orchestrates browser ownership without owning session or target truth.

- `bootstrap.mjs` coordinates profile locks, Camoufox launch/close/relaunch,
  session creation, target allocation, idle reclamation, and temporary-profile
  cleanup.
- `internal/camoufox_bridge.mjs` is the only owner of live Camoufox records and
  context/page handles.
- `services/session/manager.mjs` remains the only owner of session and target
  records.

Browser close and temporary-profile deletion are separate operations:
`stopSession` closes the browser, invalidates targets, and releases the lock;
`deleteTempProfile` removes temporary profile data. A failed deletion is
recorded as pending cleanup and surfaced by `camo status`; it is not reported
as a successful cleanup.

Browser launch and relaunch failures preserve their typed error chain. A failed
context close retains the live ownership record instead of silently dropping
the handle.
