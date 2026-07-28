# camo `start`

Boot a browser session for the given profile.

Usage:
```
camo start [--profile <id>] [--url <https://...>] [--headless]
```

Notes:
- If `--profile` is not provided, `` or `default` is used.
- The session id is returned in the result envelope; pass it to `stop`.

Exit codes (matched to `contracts/error_envelope/codes.json`):
- E_INPUT_INVALID: invalid flag value (e.g. profile pattern).
- E_STATE_DUPLICATE: a session already exists for the profile.
- E_STATE_LOCKED: profile lock cannot be acquired.
