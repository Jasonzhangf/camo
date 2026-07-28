
## 2026-03-09 camo close-page 修复

**问题**: `close-page` 返回 ok=true，但 tab 实际未关闭，变成 `about:newtab`

**根因**: Playwright 的 `page.close()` 可能在某些情况下不真正关闭页面，而是将其变为 `about:newtab`

**修复**:
1. `closePage()` 增加:
   - 使用 `{ runBeforeUnload: false }` 参数
   - 如果关闭失败，先导航到 `about:blank` 再关闭
   - 过滤掉已关闭的页面
2. `listPages()` 增加:
   - 过滤掉 `about:newtab` 和 `about:blank` 占位页面

**测试通过**: 创建 5 个 tab，关闭 1 个，剩余 4 个，total 与 list 一致

Tags: camo, close-page, playwright, bug-fix

## 2026-07-29 v2 CI registry gate 接入

- 入口 workflow: `.github/workflows/v2-registry-gates.yml`
- 触发: push/PR 到 main+master, workflow_dispatch
- 步骤:
  1. `cd v2 && node gates/run-all.mjs`  → integrity 10/10
  2. `cd v2 && node --test 'tests/unit/**/*.test.mjs'`  → 117/117
  3. v1 src/ vs origin/main diff warning（信息性）
- 默认 `run-all.mjs` 不带 `--strict`：per-resource fail 仍允许 v1 在场；stage 6（删 v1）后切 `--strict`。
- v1 `ci.yml` 不动；新 job 独立并行。

## 2026-07-29 v2 stage 6: v1 physically removed

**End state of camo v2 rebuild**

- **Source tree**: only `v2/**` exists. `src/` and `tests/` gone
  (per `git ls-files src/ | wc -l` = 0, `git ls-files tests/ | wc -l` = 0).
- **Bins**: `bin/camo` (bash wrapper) + `bin/camo.mjs` (node shim)
  both flow to `v2/shell/bin_entry/index.mjs`. `bin/browser-service.mjs`
  physically deleted (`package.json` removed its `bin:` entry too).
- **Registry**: 17 resources, all `status: active`. 16 per-resource gates.
- **Gates**:
  - `node v2/gates/run-all.mjs --strict` → registry integrity 10/10,
    per-resource 16/16.
  - `npm test` → 194 unit + 5 smoke = 199 PASS, 0 FAIL.
  - `npm run check:file-size` → 91 files OK, default 500 lines.
- **CI**:
  - `.github/workflows/v2-registry-gates.yml` runs `run-all.mjs --strict`
    (was non-strict in stage 5a; stage 6 flipped it because v1 is gone).
  - `.github/workflows/ci.yml` keeps npm test + global install; the
    `test:coverage:modes` step is reduced to a no-op until v2 builds
    a coverage matrix.

**Built-in commands (v2):** click, goto, snapshot, start, stop, type.

**Architecture rules honored:**
- Single-source-of-truth per resource (registry lists `read_paths`,
  `write_paths`, `forbidden_paths`; CI's per-resource gate verifies).
- Strict layer dependency: L0 protocol → L1 contracts → L2 services →
  L3 transports → L4 commands → L5 shell; `registry.layers.acyclic_lower_only`
  gate blocks downward edges.
- WS/HTTP envelopes are type-locked at v1 (`protocol/versions/v1.mjs`).
- CamoError projector is the only error surface (no inline throw in
  shell/bin_entry).

**Deletion strategy (replay recipe):**

1. Run import-graph scan to enumerate every file that transitively
   reaches a `forbidden_paths` target. (`/tmp/check_clean.mjs` was the
   walker in this session.) Targets:
   ```
   src/{lifecycle/{session-registry,lock},
        container/{subscription-registry,
                   runtime-core/{operations/tab-pool,search}},
        services/browser-service/{index,
                   internal/{container-matcher, page-runtime/runtime,
                             engine-manager, process-cleanup}},
        autoscript/action-providers/index,
        core/actions}.{mjs,js}
   ```
2. Delete those files plus every transitive dependent.
3. Verify `git ls-files | grep src` = 0 and no surviving imports target
   the deleted paths.
4. Flip registry + per-resource `status` from `design` → `active`.
5. Flip CI workflow to `--strict`.

**Known follow-ups (not blocking):**
- Doctor reports "commands:6 / tests:35" — this counts only what
  `shell.cli` exposes. Registry owns 17 resources; future commands can
  grow from the registry.
- No e2e harness exists yet (smoke only). Legacy `tests/` had been
  mock-only; v2 has no equivalent yet. (`v2/tests/e2e/` exists but
  empty.)
- Hard guard 36 (codex review) not yet run on this round of changes.

Tags: camo, v2, stage-6, registry-gate, strict-mode, src-deletion
