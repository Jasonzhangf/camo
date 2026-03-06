# 2026-03-06 browser service runtime integration

## Goal
Review and land the pending browser-service runtime integration in `camo`, then return to `finger`.

## What changed
- Committed pending browser-service integration as `144b972 feat: integrate browser service runtime`.
- Added packaged `browser-service` entrypoint at `bin/browser-service.mjs` and wired CLI `attach` command.
- Landed bundled browser-service runtime and controller modules under `src/services/**`.
- Switched config/data root naming from legacy `webauto` env/path semantics to `camo` semantics in runtime-facing config utilities.
- Updated autoscript example/evidence `source` paths to point at `legacy-app` instead of incorrectly pointing at `camo` itself.
- Fixed `subscription-registry` to use `loadConfig()` directly rather than stale repo-root probing.
- Added `.tmp/` to `.gitignore`.

## Review findings fixed before commit
- `src/container/subscription-registry.mjs` was missing `loadConfig` import after switching to config-backed root detection.
- `src/utils/config.mjs` incorrectly treated `CAMO_BROWSER_HOST` as a full URL; corrected to `http://<host>` when used.
- `docs/xhs-unified-migration.md` had broken wording like `camo <-> camo`; corrected migration context back to `legacy-app -> camo`.
- Multiple autoscript fixture/example files had incorrect `source` paths pointing into `camo`; corrected to `legacy-app`.
- Untracked `.tmp/` release/test leftovers were excluded from version control.

## Verification
- `npm test` passed in `/Volumes/extension/code/camo`.
- `node bin/camo.mjs --help` succeeded and included attach/browser-service help text.
- Manual launch verification passed:
  - `node bin/browser-service.mjs --host 127.0.0.1 --port 7799 --ws-port 8799`
  - `GET http://127.0.0.1:7799/health` returned `{\"ok\":true}`
  - process output showed HTTP and WS listeners started successfully.

## Notes
- The committed browser-service tree includes generated `.js` and `.map` artifacts under `src/services/browser-service/**`; these were already part of the pending change set and were reviewed as shipped runtime sources for this repo.
