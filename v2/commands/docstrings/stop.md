# camo `stop`

Stop the running browser session for a profile.

Usage:
```
camo stop [--profile <id>]
```

Notes:
- Idempotent: stopping a non-existent session returns `E_STATE_NOT_FOUND`.
- Releases the profile lock so other clients can pick it up.

Exit codes:
- E_STATE_NOT_FOUND: no active session for the profile.
- E_STATE_LOCKED: lock could not be acquired to perform the stop.
