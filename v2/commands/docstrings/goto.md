# camo `goto`

Navigate a target's page to an absolute URL.

Usage:
```
camo goto <url> [--target <t_id>] [--profile <id>] [--waitUntil load|domcontentloaded|networkidle]
```

Notes:
- `url` is the single required positional argument and must start with
  `http://` or `https://`.
- `--target` is the stable handle returned by `start`. When omitted, a profile
  with exactly one active target is selected; multiple active targets are an
  explicit ambiguity error.
- `waitUntil` defaults to `load` when omitted.

Exit codes:
- E_INPUT_INVALID: missing or malformed URL.
- E_STATE_NOT_FOUND: no active session for the profile.
- E_STATE_INVALID: the target is stale or does not belong to the profile.
- E_STATE_LOCKED: another action for the same profile is in flight.
