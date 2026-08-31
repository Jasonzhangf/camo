# Daemon Process

Single owner for creating the detached singleton daemon OS process.

- `spawnDaemonProcess()` is the only CLI-side daemon spawn operation.
- The daemon is detached and uses ignored stdio so the parent CLI's pipe
  lifetime cannot terminate the daemon through a later `EPIPE`.
- Dynamic HTTP and WebSocket ports are forced to `0` before registration.
- Registration, discovery, and shutdown truth remain owned by
  `services.daemon_registration` and `shell.daemon`.
