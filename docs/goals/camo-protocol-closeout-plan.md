# Camo Protocol Closeout Plan

## 目标与验收标准

收口 `@web-auto/camo@0.4.2` 的协议级浏览器操作，使 click、hover、type、scroll、wait、readable 的请求/执行/响应链完整且无 JS 用户动作注入；完成测试、构建、全局安装、canonical OneStop 桌面/手机真实样本验证，并取得明确 Codex review PASS。

验收必须有证据：

- 协议交互正反集成测试全绿，失败显式投影。
- `npm run gates`、`npm test`、`npm run test:all`、build 和 file-size 全绿。
- 全局 `camo` 版本与源码 hash 一致，安装后新 profile 重放成功。
- canonical OneStop 使用同一 persistent profile 完成登录、订单/商品只读验证、截图；桌面和手机 viewport 均有证据。
- review 结论明确 PASS；review 后不再修改代码。

## 范围与边界

In scope：

- `v2/services/page_runtime/operations/interaction_ops.mjs`
- `v2/services/page_runtime/operations/_page_helpers.mjs`
- `v2/services/page_runtime/operations/wait_ops.mjs`
- `v2/shell/daemon/command_handlers.mjs`
- 对应 integration tests、function/mainline/feature-test projection 和诊断证据。

Out of scope：

- OneStop 业务代码或前端补偿逻辑。
- DOM `click()`、`value=`、`scrollTo/scrollBy`、evaluate 注入用户动作。
- fallback、静默重试、profile 切换补偿。
- XHS/微博业务策略、第三方物流 API、生产排单流程。

## 设计原则

唯一 owner 是 `services.page_runtime` 的 input pipeline；daemon 只做请求字段透传和响应投影。用户动作只能由 Playwright/Camoufox 协议 mouse、keyboard、wheel 完成。定位允许使用 locator 查询，但必须选择真实可见、最具体的目标；业务调用方不得绕过 camo。

## 技术方案与文件清单

- `interaction_ops.mjs`：协议 mouse/keyboard/wheel；可见目标选择；显式错误。
- `_page_helpers.mjs`：统一 locator 解析。
- `wait_ops.mjs`：贯通 load/domcontentloaded/networkidle/selector/text/url 条件和 timeout。
- `command_handlers.mjs`：wait/readable/screenshot 等字段按契约透传，不改业务语义。
- `v2/tests/integration/page-protocol-interaction.integration.test.mjs`：正反测试。
- `v2/tests/integration/page-scroll-input.integration.test.mjs`：协议滚轮回归。
- `v2/docs/{function_map,mainline_call_map,feature_tests}.json` 与 `migration_contracts/*.md`：机器真源及生成投影锁步。

## 风险与规避

- Camoufox actionability/navigation 行为差异：不回退到 DOM 操作，使用协议事件并以真实 replay 证明。
- persistent daemon 状态漂移：检查 daemon PID、profile、health、registration 和跨 CLI 命令状态。
- CSS/资源加载异常：保存桌面/手机截图并同时读取 page info、route 和 readable，异常显式记录。
- 真实业务 mutation：仅执行已授权、可精确清理的样本；默认只读验证。

## 测试计划

1. 定向红绿：协议交互正反集成测试、滚轮回归、daemon wait/readable projection。
2. 架构 gates：registry、module ownership、edge、function/mainline/feature-test lockstep。
3. 项目测试：unit、smoke、integration、e2e、business/installed（若脚本存在）。
4. build + `npm pack --dry-run` + `npm install -g . --force`，核对 `/opt/homebrew/bin/camo`。
5. 全局 camo canonical replay：新 persistent profile；桌面与手机 viewport；仅 CLI 协议操作。
6. Codex review：完成上述证据后运行，PASS 后冻结变更。

## 实施步骤

1. 读取 MemoryPalace、resource/function/mainline/verification map，刷新 `.agent-collab` run/claim。
2. 先跑基线并记录失败的第一偏离节点。
3. 写/运行最小红测，修唯一 owner，完成正反验证。
4. 更新 JSON 真源并通过 canonical generator 更新 Markdown projection。
5. 运行全量 gates/tests/build，修复所有失败；不得用 fallback 变绿。
6. 全局安装后用新 profile 完成 OneStop 桌面/手机真实 replay，保存证据。
7. 运行 Codex review；若修改代码，全部受影响验证、安装、线上 replay 和 review 重新执行。
8. 精确提交相关文件，排除诊断临时脚本和无关脏文件；更新 note/MEMORY/local skill 并同步 MemoryPalace。

## 完成定义（DoD）

所有 required gates 绿；`test:all` 无超时或失败；全局 camo 与源码一致；canonical OneStop 桌面/手机协议操作证据完整；review 明确 PASS；提交只含本任务文件并已推送；剩余风险写入项目 MEMORY。
