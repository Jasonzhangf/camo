# camo daemon

Start, stop, or check the status of a camo daemon process. The daemon
owns the browser runtime; every browser command requires a daemon to be
running on the target profile.

```
camo daemon start [--profile <id>] [--ephemeral]
camo daemon stop  [--profile <id>]
camo daemon status [--profile <id>]
```

- `start` — spawn a new daemon for the given profile and wait for it to
  register itself. Returns the daemon pid and WS port.
- `stop` — send SIGTERM to the daemon process and wait for the
  registration file to be removed.
- `status` — read-only probe of `~/.camo/daemon/<id>.json` matching the
  profile. No daemon process is touched.

The daemon is a long-lived process; it survives across CLI invocations.
This is what the rest of the CLI talks to.
