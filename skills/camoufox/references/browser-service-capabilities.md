# Camo Capability Mapping

This reference maps runtime capabilities to the installed `camo` CLI. The
daemon resolves external targets; callers keep the returned target and never
use page indices or a current-page projection as identity.

## 1. Service and session lifecycle

- shared daemon: ordinary browser commands auto-start or reuse it; `camo
  daemon status|stop` remain low-level process operations;
- session create/reuse: `camo start [--profile <id>] [--url <url>]`;
- session close: `camo stop [--profile <id>]`;
- runtime projection: `camo status [--profile <id>] [--target <t_id>]`;
- target lifecycle: target ids are returned by `start`, `new-tab`, and
  `multi-open`; targets become stale when their session stops.

There is no `camo init`, `camo sessions`, `camo cleanup`, `camo force-stop`, or
`camo shutdown` in the current v2 CLI.

## 2. Browser and page primitives

- navigation: `camo goto`, `camo back`, `camo forward`, `camo reload`,
  `camo fetch-page`;
- page reads: `camo get-page-info`, `camo get-text`, `camo get-readable`,
  `camo snapshot`, `camo find-elements`;
- screenshot: `camo screenshot`;
- tabs: `camo new-tab`, `camo list-tabs`, `camo switch-tab`, `camo close-tab`;
- multi-page: `camo multi-open`;
- viewport: `camo set-viewport`.

All of these accept or return stable `target`/`page` information. Array order
is presentation only.

## 3. Element and interaction primitives

- protocol actions: `camo click`, `camo type`, `camo scroll`, `camo hover`,
  `camo select`, `camo upload`;
- locate: `camo find-elements`;
- wait: `camo wait`, `camo wait-dom-stable`.

Selector values are CSS. Do not use v1 pseudo-selectors or DOM/JS action
bypasses.

## 4. Cookies and browser settings

- read: `camo get-cookies --target <t_id>`;
- write: `camo set-cookies --target <t_id> --cookies '<json-array>'`;
- UA: `camo set-user-agent --target <t_id> --ua <string>`;
- viewport: `camo set-viewport --target <t_id> --width <px> --height <px>`.

Cookie persistence belongs to the profile; a cookie list is not by itself
proof of a live login. Verify the target page state.

## 5. Search

`camo search <platform> <query>` remains a standalone command. It is not a
substitute for target-driven browser actions when a specific page target is
already active.

## 6. Diagnostics

- runtime state: `camo status`;
- process/registration probe: `camo daemon status`;
- run evidence: `~/.camo/runs/run-<pid>-<ts>/events.jsonl`;
- daemon registration: `~/.camo/daemon/` (read-only; do not edit by hand).

`camo status` with no daemon returns `service.state: unavailable` and does not
start one. With a daemon, it reports sessions, targets, execution, pending
cleanup, stale locks, and stale registrations without mutating runtime state.

## 7. Safety invariants

- Reuse an existing profile by default; omit `--profile` for the persistent
  `default` profile.
- Keep one target per task. If a profile has multiple active targets, pass the
  target explicitly.
- Do not use current, foreground, newest, or array-index page selection.
- Close browser/page state separately from temporary-profile deletion.
- Do not manually delete temporary profiles after a cleanup failure; preserve
  the error and inspect pending cleanup.
- Do not use protocol bypasses, fallback retries, or broad process kills.
