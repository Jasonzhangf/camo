# v2 Mainline Call Map (design)

Top-down, one edge per line. Each edge must already exist in
`v2/resources/registry/edges.json` (gate enforces it). Anything not
here is either off-mainline (autoscript action implementation,
diagnostics, etc.) or unreached.

## Mainline edges (top down)

```
shell.cli
  -> commands.registry              load command table
  -> commands.parsers               parse argv, infer profile id
  -> services.progress_event        append cmd_log + start/end events
  -> commands.builtins              dispatch by cmd id

commands.builtins
  -> transports.client              open ws / http
  -> services.profile               read profile defaults

transports.client
  -> transports.ws                  open socket
  -> transports.http                open request

transports.ws
  -> services.browser_service       deliver envelope

services.browser_service
  -> contracts.ws_messages          parse/build envelope
  -> contracts.error_envelope       project errors
  -> services.session               create / read / delete sessions
  -> services.lock                  acquire/release on session changes
  -> services.container             match container
  -> services.subscription          fire subscriptions
  -> services.page_runtime          inject + page primitives
  -> services.display               read display metrics
  -> services.profile               resolve profile

services.session
  -> services.profile               profile input
  -> services.lock                  acquire/release
  -> services.page_runtime          tab/page ops

services.container
  -> services.page_runtime          page queries

services.subscription
  -> services.container             match source

services.autoscript
  -> services.container             subscription watcher
  -> services.page_runtime          execute operation
  -> services.progress_event        append run event

services.progress_event
  -> transports.daemon              fan out

shell.cli  --(doctor)-->  shell.doctor
shell.doctor
  -> gates.registry_gates.run.mjs   local gate invocations
  -> services.profile               read profile
```

## Forbidden edges (also enforced in registry)

- shell.* -> services.* (except shell.doctor)
- commands.* -> L0_protocol
- L4_command -> L0_protocol (commands must use contracts, never raw protocol)
- L5_shell -> L2_service (must go through command+transport)
- L3_transport -> L4_command
- transports.client -> services.lock
- commands.builtins -> services.session / container (must use transport)

## Edge status

Every edge in `edges.json` carries `status` (default: design). Gate will
refuse to flip a resource to active while its mainline edges are
design. To flip an edge to active: both module files exist, both
called + caller sides import the contract types, and a smoke test in
`tests/smoke/<edge>.smoke.mjs` runs green.
