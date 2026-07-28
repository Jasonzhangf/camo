# camo `goto`

Navigate the active page to an absolute URL.

Usage:
```
camo goto <url> [--profile <id>] [--waitUntil load|domcontentloaded|networkidle]
```

Notes:
- `url` is the single required positional argument and must start with
  `http://` or `https://`.
- `waitUntil` defaults to `load` when omitted.

Exit codes:
- E_INPUT_INVALID: missing or malformed URL.
- E_STATE_NOT_FOUND: no active session for the profile.
