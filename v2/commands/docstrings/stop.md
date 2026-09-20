# camo `stop`

Close the browser session for a profile and invalidate its targets.

Usage:
```
camo stop [--profile <id>]
```

Notes:
- Stopping a non-existent session returns `E_STATE_NOT_FOUND`.
- Releases the profile lock so other clients can pick it up.
- Targets allocated by that session become stale; a later command must use a
  target returned by a new `start`.
- For a temporary profile, `stop` also deletes the temporary profile data. If
  deletion fails, the command returns `E_BROWSER_CLEANUP_FAILED` and the
  pending cleanup remains visible through `status`.

Exit codes:
- E_STATE_NOT_FOUND: no active session for the profile.
- E_STATE_LOCKED: lock could not be acquired to perform the stop.
- E_BROWSER_CLEANUP_FAILED: temporary profile cleanup failed after the browser
  closed.
