# camo CLI Usage

## 0. Enforcement

Use the installed `camo` CLI only. Do not use `curl`, direct service imports,
CDP, DOM action injection, or ad-hoc browser-control scripts.

Check the installed command surface when uncertain:

```bash
camo --help
camo <command> --help
```

The current v2 CLI has no v1 commands such as `init`, `profile create`,
`sessions`, `cleanup`, `force-stop`, `shutdown`, `new-page`, `container`,
`autoscript`, `events`, `highlight`, `mouse`, or `window`.

## 1. Quick start

```bash
# Ordinary browser commands auto-start or reuse the shared daemon.
camo start --url https://example.com
# Save the returned target.
camo get-page-info --target <target>
camo snapshot --target <target>
camo stop
```

`camo daemon start` is optional process management; it is not required before
`start` or another browser action.

## 2. Target and profile resolution

`camo start` returns `{ profile, sessionId, target }`.

- `target` is the external page handle.
- `profile` is the persistent data boundary.
- `sessionId`, `pageId`, and `generation` are internal control fields.
- Explicit `--profile` wins; otherwise `CAMO_PROFILE` is used, then `default`.
- If a profile has multiple active targets, every browser action must pass
  `--target`. Camo does not guess the current, foreground, newest, or indexed
  page.
- A stale target or a target from another profile fails explicitly.

## 3. Command map

### Lifecycle

```bash
camo start [--profile <id>] [--url <https://...>] [--headless] [--ephemeral]
camo stop [--profile <id>]
camo status [--profile <id>] [--target <t_id>]
camo daemon status
camo daemon stop
```

`start` without `--url` does not navigate. With `--url`, only the target
allocated by that start is navigated.

### Navigation and page reads

```bash
camo goto [--target <t_id>] <url> [--waitUntil load|domcontentloaded|networkidle]
camo back [--target <t_id>]
camo forward [--target <t_id>]
camo reload [--target <t_id>] [--waitUntil load|domcontentloaded|networkidle|commit]
camo fetch-page [--target <t_id>] <url> [--timeout <ms>]
camo get-page-info [--target <t_id>]
camo get-text [--target <t_id>] [--selector <css>]
camo get-readable [--target <t_id>] [--maxLength <n>]
camo find-elements [--target <t_id>] (--selector <css>|--text <text>)
camo snapshot [--target <t_id>] [--format json|yaml]
camo screenshot [--target <t_id>] [--path <file>]
```

### Interaction

```bash
camo click [--target <t_id>] (--selector <css>|--text <text>)
camo hover [--target <t_id>] (--selector <css>|--text <text>)
camo type [--target <t_id>] <text> [--selector <css>] [--delay <ms>]
camo scroll [--target <t_id>] [--x <px>] [--y <px>] [--at-x <px>] [--at-y <px>]
camo select [--target <t_id>] --selector <css> --value <value>
camo upload [--target <t_id>] --selector <css> --file <path>
camo wait [--target <t_id>] [--for load|domcontentloaded|networkidle|selector|text|url] [--condition <value>] [--timeout <ms>] [--ms <ms>]
camo wait-dom-stable [--target <t_id>] [--timeout <ms>] [--poll <ms>]
camo scroll-and-collect [--target <t_id>] [--scrollCount <n>] [--delay <ms>]
```

### Tabs, cookies, and settings

```bash
camo new-tab [--target <t_id>] [--url <url>]
camo list-tabs [--target <t_id>]
camo switch-tab --target <t_id>
camo close-tab --target <t_id>
camo multi-open [--target <t_id>] --urls <u1,u2,...> [--out-dir <dir>] [--prefix <name>]
camo get-cookies [--target <t_id>]
camo set-cookies [--target <t_id>] --cookies '<json-array>'
camo set-user-agent [--target <t_id>] --ua <string>
camo set-viewport [--target <t_id>] --width <px> --height <px>
```

`new-tab` and `multi-open` return new stable target/page ids. `list-tabs` and
`switch-tab` return stable target/page information; array position is
presentation only.

## 4. Practical flows

### Headless verification

```bash
camo start --headless --url https://example.com
# target
camo get-page-info --target <target>
camo screenshot --target <target> --path /tmp/example.png
camo stop
```

### Multiple targets in one profile

```bash
camo start --profile task-a --url https://example.com/a
# target-a
camo new-tab --profile task-a --target <target-a> --url https://example.com/b
# target-b
camo get-page-info --profile task-a --target <target-a>
camo get-page-info --profile task-a --target <target-b>
camo stop --profile task-a
```

### Temporary profile

```bash
camo start --profile temp --headless --url https://example.com
# Save the returned profile and target.
camo get-page-info --profile <returned-profile> --target <target>
camo stop --profile temp
```

`stop` closes the browser before deleting temporary data. If deletion fails,
preserve `E_BROWSER_CLEANUP_FAILED` and inspect `camo status`; do not manually
delete the profile as a substitute.

## 5. Failure handling

```bash
camo status --profile <profile>
camo status --target <target>
camo get-page-info --target <target>
camo snapshot --target <target>
camo screenshot --target <target> --path /tmp/camo-failure.png
```

- `E_STATE_INVALID`: stale target, cross-profile target, or multiple targets
  without `--target`.
- `E_STATE_NOT_FOUND`: session, target, or daemon resource is absent.
- `E_BROWSER_CLEANUP_FAILED`: temporary profile deletion failed; pending
  cleanup remains visible in `status`.
- `E_BROWSER_CLOSE_FAILED`: context close failed; live ownership truth is
  retained instead of reporting a false close.

Do not switch profiles or fall back to `evaluate` after a failure. Diagnose on
the same target, then explicitly start a new session/target if the old one is
stale.
