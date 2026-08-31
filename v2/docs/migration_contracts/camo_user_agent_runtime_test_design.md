# `set-user-agent` runtime transition test design

## Contract

`camo set-user-agent --ua <string>` changes the active profile's browser
context by reopening it with the requested user agent. The network user agent
and `navigator.userAgent` must be identical. The profile's persisted cookies,
active URL, and viewport must survive a successful transition. The command
must project `set: true` only after the transition has completed.

## Lifecycle

1. Validate the profile and requested UA.
2. Serialize the transition through the input pipeline.
3. Capture the active page URL and viewport.
4. Close the current context and relaunch the same persistent profile with the
   requested UA at the engine/context creation boundary.
5. Restore the captured URL and keep the profile's persistent cookies.
6. Return exact success truth; on any transition failure, expose a typed error
   and remove stale browser/session/lock truth.

## Tests

- White-box: a Camoufox launch receives the runtime UA and applies the same UA
  to the page fingerprint projection; no `Page.setUserAgent` call remains.
- Module black-box: a successful transition preserves URL and viewport and
  returns the requested UA.
- Module black-box negative: a relaunch or URL restore failure is explicit and
  leaves no active browser/session/lock record.
- Project black-box: the CLI wire response contains `set: true` only when the
  browser-service transition returns success; malformed success-shaped replies
  are rejected.
- Project black-box negative: concurrent same-profile transitions are rejected
  by the existing input-pipeline serialization contract.

## Known boundary

This command owns a session-local UA override. It does not rewrite the
persistent fingerprint file, so a later fresh profile start returns to the
profile's stored fingerprint UA unless the caller sets a new runtime UA.
