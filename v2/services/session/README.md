# services-session

Single truth owner for `browser_session` and `browser_target`.

`manager.mjs` owns the in-process session and target registries:

- a session records `profileId`, `instanceId`, `generation`, status, and
  activity time;
- a target records `targetId`, profile, session generation, stable `pageId`,
  status, and the internal page handle;
- `allocateTarget`, `resolveTarget`, `resolveTargetForProfile`, `listTargets`,
  and `invalidateTarget` are the only target lifecycle surface;
- closing a session invalidates every target bound to that session generation.

External callers use `targetId`. `profileId`, `sessionId`, `pageId`, and
`generation` remain internal control fields. Page runtime receives a resolved
target with an internal page handle and must not resolve targets or write this
registry.

When a profile has more than one active target, resolution without `--target`
returns `E_STATE_INVALID`; the daemon never selects the current, foreground,
newest, or indexed page as a substitute.
