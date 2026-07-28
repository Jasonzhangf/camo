
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
