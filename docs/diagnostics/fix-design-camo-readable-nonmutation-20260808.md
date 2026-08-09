# Fix Design Report: CAMO-FIX-READABLE-NONMUTATION-20260808-R1

## Scope

Fix `get-readable` so extraction never mutates the live page. The change is
limited to the page-runtime query owner and its positive/negative integration
test. OneStop business code and browser-action semantics are unchanged.

## Baseline reproduction

Using globally installed `camo@0.4.2` with a fresh profile against canonical
`https://claw.codewhisper.cc/onestop/admin`:

1. Screenshot before `get-readable` rendered the styled login card.
2. `get-readable` returned only `居中裁切使用裁切结果`.
3. Screenshot after the same call rendered an unstyled document with the
   login and password-reset panels simultaneously visible.

Evidence:

- `/tmp/onestop-readable-before.png`
- `/tmp/onestop-readable-after.png`
- before SHA-256: `fc6416c80998d05945c9fba58d85547504d3f84f517636394e471109f4a4a9fe`
- after SHA-256: `36f8527d7950b91fd1af52f5c316fb8ed5eb76d20d66cdd7925ba90fb7e4294d`

## First divergence and root cause

The first divergent node is
`v2/services/page_runtime/operations/query_ops.mjs::getReadable`. Before it
selects an article and clones it, the evaluator removes `script`, `style`,
`nav`, `header`, and other nodes from the live `document`. Removing the live
style nodes immediately destroys page presentation; selecting the extraction
root after live removals also changes the readable result.

## Causal intervention

Experiment worktree:
`/private/tmp/camo-readable-exp-20260808` at base `166f66c4e826af91a3d257a30d626c070490c4dd`.

- Baseline red test recorded eight live-document queries/removals.
- Positive intervention moved all removal to the selected root clone; the same
  test passed with zero live queries/removals and one clone removal.
- Reverse condition is the base implementation captured by the initial red
  result; restoring live-document removal reproduces the failure deterministically.

## Unique owner and boundaries

- Resource: `input_pipeline`
- Module owner: `services.page_runtime`
- Unique implementation point:
  `v2/services/page_runtime/operations/query_ops.mjs::getReadable`
- Allowed paths:
  - `v2/services/page_runtime/operations/query_ops.mjs`
  - `v2/tests/integration/page-readable-nonmutation.integration.test.mjs`
  - feature/function/mainline/verification maps and generated projections
- Forbidden paths:
  - OneStop source
  - daemon/caller compensation
  - browser reload after query
  - silent DOM restoration or fallback extraction path

## Approved implementation

Select `article`, `main`, or `body` from the live document, clone that root,
remove non-readable nodes only inside the clone, then return the bounded text.
The live document is read-only for the whole operation.

## Required verification

- Positive readable text and truncation projection.
- Negative mutation lock: live `querySelectorAll` and live node removals remain
  zero; cleanup occurs only in the clone.
- Existing protocol interaction and daemon projection integration tests.
- Full gates, `npm test`, `npm run test:all`, build, file-size, pack.
- Global reinstall and fresh canonical desktop/mobile replay showing identical
  styled screenshots before and after `get-readable`.

## Approval

Jason's prior repeated `批准` / `继续` authorization covers the current closeout
design while owner, base, scope, data shape, and module boundary remain exactly
as specified above.
