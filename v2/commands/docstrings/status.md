# camo `status`

Read the current camo runtime state without starting or modifying it.

Usage:
```
camo status [--profile <id>] [--target <t_id>]
```

The result contains `service`, `profiles`, `targets`, `execution`,
`reclamation`, and `errors`. `--profile` and `--target` are optional filters.

`status` is read-only:
- it does not start a daemon or browser;
- it does not repair the environment;
- it does not refresh session idle time;
- it does not append progress events or enter the profile in-flight set;
- when no daemon is running it returns `service.state: unavailable`.

`--target` filters the projection by stable target id. `--profile` filters by
profile; it does not choose a target for browser actions.
