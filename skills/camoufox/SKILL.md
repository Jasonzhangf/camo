---
name: camoufox
description: |
  Use the installed `camo` CLI for target-driven Camoufox browser automation.
  A shared daemon hosts multiple named profiles. Start a session, keep the
  returned target, and pass that target to later browser actions.

  Quick start:
  camo start --url https://example.com
  # Save the returned target, for example t_abc123.
  camo get-page-info --target t_abc123
  camo click --target t_abc123 --selector "h1"
  camo status --target t_abc123
  camo stop

  Browser commands auto-start or reuse the shared daemon. Do not run a separate
  daemon preparation step. `camo status` is read-only and does not start one.
---

# Camo Browser CLI (Camoufox)

Use the installed `camo` binary only. The installed `camo --help` and
`camo <cmd> --help` are the command-shape truth.

## Ground rules

- **One shared daemon.** Ordinary browser commands discover or start it
  automatically. `camo daemon start` is optional process management, not a
  prerequisite.
- **Target is the external handle.** `camo start`, `camo new-tab`, and
  `camo multi-open` return stable target ids. Pass the target to later actions.
- **The daemon resolves targets.** Page runtime receives an internal page
  handle. Callers must not use current, foreground, newest, or array-index page
  selection.
- **One profile is one data boundary.** Explicit `--profile` wins; otherwise
  `CAMO_PROFILE` is used, then `default`.
- **Actions are serialized per profile.** Do not issue overlapping actions for
  one profile.
- **`status` is read-only.** It does not start a daemon or browser, refresh
  idle time, append progress, or change page/process state. With no daemon it
  returns `service.state: unavailable`.
- **Close and cleanup are separate.** `close-tab` closes a page and never
  deletes profile data. `stop` closes the session and owns temporary-profile
  cleanup.
- **Temporary cleanup is explicit.** A temporary profile is reused until
  `stop`; cleanup failure returns `E_BROWSER_CLEANUP_FAILED` and remains
  visible as pending cleanup in `status`.
- **No bypass.** Do not use DOM `click()`, JS `scrollTo`/`scrollBy`,
  `history.back()`, `value=` injection, CDP, direct service imports, or
  ad-hoc wrappers. No silent fallback or retry.

## Standard flow

```bash
camo start --url https://example.com
# Use the returned target from this point on.
camo get-page-info --target <target>
camo snapshot --target <target>
camo click --target <target> --selector "h1"
camo stop
```

For a profile with multiple targets, every browser action must pass its
target:

```bash
camo start --profile task-a --url https://example.com/a
# target-a
camo new-tab --profile task-a --target <target-a> --url https://example.com/b
# target-b
camo get-page-info --profile task-a --target <target-a>
camo get-page-info --profile task-a --target <target-b>
camo stop --profile task-a
```

For a temporary profile:

```bash
camo start --profile temp --headless --url https://example.com
# Save the returned profile and target.
camo get-page-info --profile <returned-profile> --target <target>
camo stop --profile temp
```

`stop` closes the browser first and then removes temporary profile data. If
cleanup fails, preserve the error and inspect `camo status`; do not manually
delete the profile as a substitute.

## Command reference

All browser actions accept `[--profile <id>]`; actions on a profile with more
than one active target also require `[--target <t_id>]`.

### Lifecycle

```bash
camo start [--profile <id>] [--url <https://...>] [--headless] [--ephemeral]
camo stop [--profile <id>]
camo status [--profile <id>] [--target <t_id>]
camo daemon status
camo daemon stop
```

`start` without `--url` does not navigate the page. With `--url`, only the
target allocated by that start is navigated.

### Navigation and page reads

```bash
camo goto <url> [--target <t_id>] [--waitUntil load|domcontentloaded|networkidle]
camo back [--target <t_id>]
camo forward [--target <t_id>]
camo reload [--target <t_id>] [--waitUntil load|domcontentloaded|networkidle|commit]
camo snapshot [--target <t_id>] [--format json|yaml]
camo screenshot [--target <t_id>] [--path <file>]
camo evaluate [--target <t_id>] --script <js>
camo wait [--target <t_id>] [--for load|domcontentloaded|networkidle|selector|text|url] [--condition <value>] [--timeout <ms>] [--ms <ms>]
camo find-elements [--target <t_id>] (--selector <css>|--text <text>)
camo get-text [--target <t_id>] [--selector <css>]
camo get-readable [--target <t_id>] [--maxLength <n>]
camo get-page-info [--target <t_id>]
camo fetch-page [--target <t_id>] <url> [--timeout <ms>]
```

### Interaction and browser settings

```bash
camo click [--target <t_id>] (--selector <css>|--text <text>)
camo type [--target <t_id>] <text> [--selector <css>] [--delay <ms>]
camo scroll [--target <t_id>] [--x <px>] [--y <px>] [--at-x <px>] [--at-y <px>]
camo hover [--target <t_id>] (--selector <css>|--text <text>)
camo upload [--target <t_id>] --selector <css> --file <path>
camo select [--target <t_id>] --selector <css> --value <value>
camo get-cookies [--target <t_id>]
camo set-cookies [--target <t_id>] --cookies '<json-array>'
camo set-user-agent [--target <t_id>] --ua <string>
camo set-viewport [--target <t_id>] --width <px> --height <px>
```

### Tabs and multi-open

```bash
camo new-tab [--target <t_id>] [--url <https://...>]
camo list-tabs [--target <t_id>]
camo switch-tab --target <t_id>
camo close-tab --target <t_id>
camo multi-open [--target <t_id>] --urls <u1,u2,...> [--out-dir <dir>] [--prefix <name>]
```

`new-tab` and `multi-open` return new target/page ids. `list-tabs` and
`switch-tab` return stable target/page information; array position is
presentation only.

## Login flow

Use one profile throughout. Do not run other camo commands while `camo login`
is active.

```bash
camo login --url https://auth.example.com/login \
  --until-cookie-name authorization \
  --until-url example.com/account \
  --timeout 600000
camo get-cookies --target <target>
```

Cookie presence is evidence only when paired with the expected page state.
Reuse the same profile after `stop` and a later `start`.

## Failure handling

1. Keep the original error and target.
2. Run `camo status --profile <profile>` and `camo status --target <target>`.
3. Collect read-only evidence with `get-page-info` and `snapshot` on the same
   target.
4. Do not switch profiles, retry with a different page, or use `evaluate` as a
   substitute for the failed command.
5. For a stale target, start a new session or allocate a new target and use
   only the new returned id.

Common errors:

- `E_STATE_INVALID`: stale target, cross-profile target, or multiple active
  targets without `--target`.
- `E_STATE_NOT_FOUND`: target/session/daemon resource is absent.
- `E_BROWSER_CLEANUP_FAILED`: temporary profile deletion failed after the
  browser closed; inspect pending cleanup in `status`.
- `E_BROWSER_CLOSE_FAILED`: context close failed; ownership truth is retained
  instead of reporting a false close.

## Safety

- Reuse an existing profile unless isolation is required.
- Never manually delete a profile to hide a cleanup failure.
- Never use broad process-kill commands.
- Never edit daemon registration or profile lock files by hand.
- Never treat logs, snapshots, or payload fields as control truth.
