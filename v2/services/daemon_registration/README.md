# Daemon Registration

Single owner for shared daemon discovery and registration lifecycle.

- `claimDaemonSlot()` publishes a complete owner record with an atomic hard
  link before network listeners start.
- The claim token and OS process-start identity prevent PID reuse from
  projecting a stale daemon as active.
- `registerDaemon()` atomically advances the same canonical record from
  `claimed` to `active`; there is no second registration truth to half-commit.
- `unregisterDaemon()` removes that canonical record only after browsers and
  both protocol servers are closed.
- Dead-owner recovery is serialized and revalidates the observed owner token
  before removing stale truth.
- Recovery serialization uses a stale-aware filesystem mutex. A crashed
  recovery owner cannot leave a permanent startup blocker; dead recovery JSON
  and stale mutex state are reclaimed before canonical takeover.
- Shell compatibility exports are read-only.
