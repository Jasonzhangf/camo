# Fix Design Report: CAMO-FIX-NPM-INSTALL-PLAYWRIGHT-CONTRACT-20260808-R1

## Scope

Make the published npm artifact installable and make its Camoufox runtime use
the repository-approved `playwright-core@1.60.0`. This is release wiring only;
browser action semantics and OneStop code remain unchanged.

## Baseline reproduction

After `npm pack`, installing the tarball with
`npm install -g web-auto-camo-0.4.2.tgz --force` fails in postinstall. The
tarball dependency tree resolves Camoufox's broad `^1.54.1` range to
`playwright-core@1.62.1`; Camoufox then sends the unsupported
`viewport.isMobile` field and browser creation fails before page navigation.

The source worktree uses pnpm's root override and resolves
`playwright-core@1.60.0`, so `npm install -g .` merely creates a link to the
working source tree and does not prove the packed artifact.

## First divergence and causal proof

The first divergence is the root package manifest: it declares Camoufox only
as a peer and expresses the `playwright-core` pin only in pnpm-specific
metadata. npm consumers therefore have no enforceable dependency on the
approved protocol client version.

An isolated tarball install reproduced the failure with 1.62.1. Placing 1.60.0
at Camoufox's resolution boundary made the unchanged postinstall launch return
`TITLE:Example Domain`, proving the version resolution is causal.

## Unique owner and boundaries

- Release dependency owner: root `package.json` plus `package-lock.json`.
- Postinstall verifier: `scripts/postinstall-camoufox.mjs`.
- Allowed paths: root package manifests, package/install regression tests,
  closeout diagnostics and verification maps.
- Forbidden paths: runtime fallback, disabling postinstall verification,
  accepting arbitrary Playwright versions, or caller-side compensation.

## Approved implementation

- Make `camoufox@0.1.19` and exact `playwright-core@1.60.0` runtime
  dependencies of the published root package.
- Keep the pnpm override so both package managers resolve the same engine
  protocol version.
- Regenerate the npm lockfile and add a packed-artifact dependency assertion.
- Keep postinstall fail-fast; do not weaken or skip browser verification.

## Required verification

- Packed tarball excludes nested `node_modules`.
- Fresh isolated npm install resolves Camoufox and Playwright 1.60.0.
- Tarball postinstall launches Camoufox and verifies Example Domain.
- Global install from the actual tarball succeeds; installed files match the
  source hashes.
- Full gates/tests/build/pack and canonical OneStop replay remain green.

## Approval

This closes the explicit global-install requirement in the already approved
camo protocol closeout. Owner, business scope, action semantics, and base
intent are unchanged.
