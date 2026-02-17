---
name: camoufox
description: Use this skill only when executing Camoufox tasks through the local camo CLI, covering profile/session lifecycle, container subscription, autoscript orchestration, events, and cleanup diagnostics.
license: Complete terms in LICENSE.txt
metadata:
  short-description: camo-only runbook for Camoufox
---

# Camoufox (`camo`) Skill

This skill is **camo CLI only**.

## Hard Constraint

Allowed execution surface:
- `camo ...`

Disallowed execution surface:
- direct `curl` to browser/unified APIs
- direct `node scripts/...` for browser control
- direct controllerAction / custom wrappers when an equivalent `camo` command exists

If a required action is unclear or missing, run:

```bash
camo --help
camo <command> --help
```

Then report capability gap instead of switching control surface.

## Trigger Conditions

- User asks to manage Camoufox profiles/sessions with CLI.
- User asks to operate browser via CLI (`start/goto/click/type/scroll/screenshot/...`).
- User asks for container subscription operations (`container init/register/watch/...`).
- User asks for autoscript orchestration (`autoscript validate/explain/run/resume/...`).
- User asks to observe progress via ws/jsonl events (`events serve/tail/recent/emit`).
- User asks to recover stuck sessions/locks with cleanup commands.

## Standard Execution Order

1. Confirm command availability
   - `which camo`
   - `camo --help`
2. Prepare profile/default profile
   - `camo profile create ...` / `camo profile default ...`
3. Start or reuse browser session
   - `camo start ...` / `camo status ...`
4. Execute workflow command path
   - browser primitives (`goto/click/type/...`) or
   - container/subscription (`container ...`) or
   - autoscript strategy (`autoscript ...`)
5. Collect evidence
   - `camo status`, `camo sessions`, `camo screenshot ...`
   - `camo events recent` / `camo events tail ...`
6. Cleanup when needed
   - `camo cleanup ...`, `camo force-stop ...`, `camo shutdown`

## Core Command Families

- Profile management: `profiles`, `profile list/create/delete/default`
- Initialization/config: `init`, `init geoip`, `init list`, `create fingerprint`, `create profile`, `config repo-root`
- Browser/session lifecycle: `start`, `stop`, `status`, `list`, `sessions`, `cleanup`, `force-stop`, `lock`, `unlock`
- Browser actions: `goto`, `back`, `scroll`, `click`, `type`, `screenshot`, `highlight`, `clear-highlight`, `viewport`
- Pages/tabs: `new-page`, `close-page`, `switch-page`, `list-pages`
- Cookies/window/mouse/system: `cookies ...`, `window move/resize`, `mouse move/click/wheel`, `system display`, `shutdown`
- Container subscription layer: `container init/sets/register/targets/filter/watch/list`
- Autoscript strategy layer: `autoscript scaffold/validate/explain/snapshot/replay/run/resume/mock-run`
- Progress events: `events serve/tail/recent/emit` (non-events commands auto-start daemon)

## Environment Variables

- `WEBAUTO_BROWSER_URL` (default `http://127.0.0.1:7704`)
- `WEBAUTO_REPO_ROOT` (optional explicit repo root)
- `CAMO_PROGRESS_EVENTS_FILE` (optional progress JSONL path)
- `CAMO_PROGRESS_WS_HOST` / `CAMO_PROGRESS_WS_PORT` (progress ws daemon host/port)

## Minimum Verification Checklist

After making changes to camo flow, verify at least:

```bash
camo --help
camo container --help
camo autoscript --help
camo events --help
```

For autoscript/runtime related updates, also verify:

```bash
camo autoscript scaffold xhs-unified --output /tmp/xhs-unified.sample.json
camo autoscript validate /tmp/xhs-unified.sample.json
camo autoscript explain /tmp/xhs-unified.sample.json
```

## References

- `references/camo-cli-usage.md`
- `references/browser-service-capabilities.md`
