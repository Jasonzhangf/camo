# Camoufox binary input-liveness compatibility test design

## Goal and first divergence

`browser.installation_readiness` must reject a browser/protocol pair that is
known to deadlock Camo's serialized input pipeline. The current first
divergence is `v2/shell/camoufox_health.mjs::checkCamoufoxHealth`: it reports
`ok: true` from `properties.json` presence without validating
`version.json` or the resolved `playwright-core` version.

The only admitted runtime pair for this change is:

- Camoufox executable `152.0.4-beta.29`;
- `playwright-core` `1.60.0`.

## Lifecycle cases

1. Missing executable or missing version manifest: explicit unhealthy result.
2. Malformed version manifest: explicit unhealthy result; no silent repair.
3. Valid but stale `152.0.4-beta.28`: explicit incompatible result; the
   canonical package fetch owner may update it before a browser command.
4. Exact `152.0.4-beta.29` with Playwright `1.60.0`: installation-ready,
   while `launchVerified` remains false because launch truth belongs to the
   daemon browser service.
5. Exact browser with Playwright `1.61.0` or another unverified protocol
   version: explicit incompatible result; fetching a browser cannot repair it.
6. After official fetch, health is checked again and must match the exact
   admitted pair before Camo continues.

## White-box checks

- The version validator is pure and compares all three fields exactly.
- Health reads `<camoufox-cache>/version.json` and the actually resolved
  `playwright-core/package.json`.
- `ensureCamoufox` fetches only a missing or valid-but-stale browser binary,
  checks the fetch exit code, and re-runs health.
- Malformed manifests and Playwright mismatches fail without fallback.

## Module black-box checks

- `checkCamoufoxHealth()` rejects beta.28, missing manifests, and malformed
  manifests from an isolated fake home.
- It accepts beta.29 only with the repository's resolved Playwright 1.60.0.
- It never claims browser launch verification.

## Project black-box checks

- Package dependency gates continue to pin `camoufox@0.1.19` and
  `playwright-core@1.60.0`.
- Strict registry, build, package, and full tests pass.
- The exact installed Camo package reports beta.29 in the cache manifest.
- Through one fixed Camo profile, repeated visible clicks, type, wheel, and
  the Claw button sequence complete without retaining `input_pipeline`.

## Negative boundaries

- Do not upgrade Playwright to 1.61+.
- Do not add timeout, retry, DOM injection, evaluate, locator fallback, or an
  alternate browser.
- Do not change `interaction_ops` in this issue.
- A green unit test without installed-package and same-profile Camo replay is
  not completion evidence.

## Known gap before live replay

Unit tests model version admission, not Juggler itself. The upstream beta.28
red/beta.29 green regression proves the engine defect; Camo's same-profile
installed-runtime replay is still required to prove this integration.
