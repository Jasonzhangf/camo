# 2026-03-06 camo profile session isolation

## Goal
Fix camo profile/session lifecycle so each profile is isolated and stop/cleanup/force-stop only affect the targeted profile.

## Changes
- Added unified resolved session view in `src/lifecycle/session-view.mjs`.
- `status`, `sessions`, and `instances` now share the same resolved session truth instead of mixing separate merge logic.
- `getSessionByProfile()` now only returns a session when the target profile is actually live; it no longer fabricates session existence from `page:list` for non-live profiles.
- `list-pages <profile>` now fails fast when the profile is not live.
- `resolveSessionTarget()` now detects ambiguous alias / instanceId matches and throws instead of picking arbitrarily.
- Alias uniqueness now reserves aliases for both `active` and `reconnecting` registry states.
- `--help` now documents profile isolation semantics and the meanings of `live`, `registered`, `orphaned`, and `needsRecovery`.

## Verification
- Unit tests passed:
  - `tests/unit/lifecycle/session-registry.test.mjs`
  - `tests/unit/utils/browser-service.test.mjs`
  - `tests/unit/commands/lifecycle.test.mjs`
  - `tests/unit/commands/browser.test.mjs`
- Full `npm test` passed after the targeted changes.
- Manual CLI verification with two profiles:
  - `finger` and `xhs-qa-1` were live together.
  - `camo sessions` showed both profiles independently.
  - `camo list-pages finger` worked while `finger` was live.
  - `camo stop finger` removed only `finger`; `xhs-qa-1` stayed live and `camo list-pages xhs-qa-1` still worked.
- Screenshots saved during verification:
  - `/tmp/camo-session-isolation/finger-live.png`
  - `/tmp/camo-session-isolation/xhs-live.png`

## Note
A misleading `status finger = null` result happened once because `status finger` and `stop finger` were accidentally launched in parallel during manual verification, not because of the isolation logic itself. Sequential verification confirmed the profile isolation behavior is correct.


## Follow-up hardening
- Added explicit guardrails so `camo cleanup` and `camo force-stop` reject `--id` / `--alias` and require direct `profileId` targeting.
- Updated `README.md` and `skills/camoufox/references/camo-cli-usage.md` to document session isolation semantics and `list-pages` live-only behavior.
- Updated `skills/camoufox/SKILL.md` so future agents keep `profileId` as the only lifecycle primary key.
- Added tests covering lifecycle indirect-target rejection and help output session-isolation text.


## Packaging prep
- Added explicit isolation examples to `camo --help` so valid and invalid lifecycle patterns are visible directly in CLI help.
- Verified targeted tests for lifecycle/help, rebuilt package, and ran `npm pack` successfully.
- Prepared npm tarball: `web-auto-camo-0.1.22.tgz`.


## Release follow-up
- `npm publish` for `0.1.22` failed because that version already existed on npm.
- Bumped package version to `0.1.23` with `npm version patch --no-git-tag-version`.
- Rebuilt and re-packed the package to prepare a publishable tarball for the next release attempt.
