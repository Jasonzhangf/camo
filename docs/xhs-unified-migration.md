# XHS Unified Migration (camo <-> webauto)

## Scope

This document tracks migration of XHS app-level automation from:

- `/Users/fanzhang/Documents/github/webauto/modules/xiaohongshu/app/src/blocks/*`
- `/Users/fanzhang/Documents/github/webauto/scripts/xiaohongshu/phase-unified-harvest.mjs`

into local camo autoscript runtime and provider blocks.

## Current Status (2026-02-16)

Implemented in camo:

- Blockized XHS action provider:
  - `src/autoscript/action-providers/xhs/search.mjs`
  - `src/autoscript/action-providers/xhs/detail.mjs`
  - `src/autoscript/action-providers/xhs/comments.mjs`
  - `src/autoscript/action-providers/xhs/interaction.mjs`
  - `src/autoscript/action-providers/xhs/persistence.mjs`
  - `src/autoscript/action-providers/xhs/like-rules.mjs`
  - `src/autoscript/action-providers/xhs.mjs` (router only)
- Persistence aligned to webauto output semantics:
  - `comments.jsonl` incremental merge
  - `.like-state.jsonl` signature dedupe
  - `like-evidence/<noteId>/` screenshots + `summary-*.json`
- Autoscript template/scaffold parameterization:
  - supports `env`, `outputRoot`
  - passes persistence params to `xhs_comments_harvest` / `xhs_comment_like`

## Run Commands

```bash
camo autoscript scaffold xhs-unified \
  --output ./autoscripts/xiaohongshu/unified-harvest.autoscript.json \
  --profile xiaohongshu-batch-1 \
  --keyword "手机膜" \
  --env debug \
  --output-root ~/.webauto/download \
  --do-comments \
  --do-likes \
  --max-notes 30
```

```bash
camo autoscript validate ./autoscripts/xiaohongshu/unified-harvest.autoscript.json
camo autoscript explain ./autoscripts/xiaohongshu/unified-harvest.autoscript.json
camo autoscript run ./autoscripts/xiaohongshu/unified-harvest.autoscript.json --profile xiaohongshu-batch-1
```

## Block Mapping

- `Phase34OpenDetailBlock` -> `xhs_open_detail` (`search.mjs`)
- `Phase34ExtractDetailBlock` -> `xhs_detail_harvest` (`detail.mjs`)
- `Phase34CollectCommentsBlock` -> `xhs_comments_harvest` (`comments.mjs`) + `persistence.mjs`
- `Phase3InteractBlock` like path -> `xhs_comment_like` (`interaction.mjs`, `like-rules.mjs`, `persistence.mjs`)
- `ReplyInteractBlock` -> `xhs_comment_reply` (`interaction.mjs`)
- `Phase34CloseDetailBlock` -> `xhs_close_detail` (`detail.mjs`)
- `MatchCommentsBlock` -> `xhs_comment_match` (`comments.mjs`)

## webauto Cleanup Targets (after migration acceptance)

Primary candidates to freeze/remove from active pipeline:

- `scripts/xiaohongshu/phase3-interact.mjs`
- `scripts/xiaohongshu/phase4-harvest.mjs`
- `scripts/xiaohongshu/phase-unified-harvest.mjs` (replace by camo autoscript run)
- Legacy scripts under `scripts/xiaohongshu/legacy/`
- Duplicated test/debug entry scripts under `scripts/xiaohongshu/tests/` that only verify old phase orchestration

Keep temporarily (migration bridge):

- `modules/xiaohongshu/app/src/blocks/helpers/*` (reference behavior)
- `modules/workflow/blocks/PersistXhsNoteBlock.ts` (compatibility validation)
- `scripts/xiaohongshu/lib/runtime-ready.mjs`, `lib/recovery.mjs` (until camo side runbook is fully adopted)

## Migration Sequence

1. Lock camo parity:
   - comments harvest/persist and like evidence semantics
   - minimum E2E run for target keyword + note count
2. Switch scheduler entry:
   - use `camo autoscript run` as primary runner
   - keep webauto phase runner as fallback only
3. Decommission old phase scripts:
   - remove active references from orchestration entrypoints
   - archive legacy and duplicate test scripts
4. UI/structure redesign:
   - webauto app layer keeps only session/profile/control UI
   - page automation logic remains in camo blockized provider

## Risks

- Like-state signature key mismatch between old/new implementations can cause duplicated likes.
- Evidence path divergence (`virtual-like` vs `like-evidence`) may affect downstream tooling.
- Existing very large files in camo runtime (`runtime.mjs`, `tab-pool.mjs`) still exceed file-size policy and should be split separately.
