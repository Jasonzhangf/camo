# camo daemon

Start, stop, or check the status of a camo daemon process. The daemon
owns the shared browser runtime; browser commands select a profile inside that
one daemon.

```
camo daemon start [--profile <id>] [--ephemeral]
camo daemon stop  [--profile <id>]
camo daemon status [--profile <id>]
```

- `start` — spawn the shared daemon when absent and wait for its canonical
  registration. An existing shared daemon is returned regardless of profile.
- `stop` — send SIGTERM to the daemon process and wait for the
  registration file to be removed.
- `status` — read-only probe of
  `~/.camo/daemon/.shared-daemon.claim`. No daemon process is touched.

The daemon is a long-lived process; it survives across CLI invocations.
This is what the rest of the CLI talks to.
