# Camo daemon loopback endpoint test design

## Scope

Feature `daemon.endpoint.loopback` owns the local daemon endpoint contract:
the daemon binds HTTP and WebSocket listeners to one exact loopback host,
publishes that host with both dynamic ports, and the CLI connects only to the
published endpoint.

Allowed implementation paths:

- `v2/services/daemon_registration/registry.mjs`
- `v2/shell/daemon/index.mjs`
- `v2/shell/bin_entry/index.mjs`
- `v2/shell/config/loader.mjs`
- daemon lifecycle and registration tests
- shell config tests proving there is no second endpoint truth
- feature/function/call/verification maps for this contract

Forbidden paths:

- browser session, profile, page runtime, or input pipeline changes
- DNS alias or wildcard listener fallback
- caller retry after a connection reaches another process
- manual daemon/claim-file repair

## Lifecycle

1. Daemon claims the singleton registration.
2. HTTP and WebSocket servers bind `127.0.0.1` with dynamic ports.
3. Registration publishes `host`, `httpPort`, and `wsPort` atomically.
4. CLI reads the active registration and connects to the exact host and port.
5. Shutdown removes the registration after both listeners close.

## Positive gates

- Registration with `host=127.0.0.1` parses.
- E2E daemon startup publishes the exact host and accepts a WebSocket ping on
  that endpoint.
- Live installed CLI starts the existing profile and records
  `ws.connected -> command.start -> session.start -> session.started`.

## Negative gates

- Missing host is rejected as `E_CONFIG_INVALID`.
- DNS alias `localhost` is rejected; endpoint selection cannot depend on DNS
  address order.
- Shell config exposes no `wsUrl` or `httpUrl`; endpoint discovery cannot be
  overridden by a dead second source.
- A loopback-specific foreign listener must not receive the Camo CLI command;
  live verification checks the installed daemon chose an exact-loopback port
  not already owned by that listener.

## Completion evidence

- Paired registration tests and daemon lifecycle E2E pass.
- Full test, strict registry, build, file-size, and package gates pass.
- Global installation is byte-identical to this worktree.
- Same-profile Camo-only replay reaches the OneStop page with no WS timeout.
