# XHS Unified 脚本手动 Operation 验证记录（camo CLI）

- 验证日期: 2026-02-16
- 验证方式: 仅使用 `camo` CLI 手动操作
- 目标脚本: `autoscripts/xiaohongshu/unified-harvest-workwear.autoscript.json`
- 验证 profile: `xiaohongshu-batch-1`

## 1. 前置检查

- `camo autoscript validate autoscripts/xiaohongshu/unified-harvest-workwear.autoscript.json`: 通过（仅 warning: `comment_reply` disabled）
- `camo autoscript explain autoscripts/xiaohongshu/unified-harvest-workwear.autoscript.json`: 解析成功，operation 顺序共 19 个
- `camo start xiaohongshu-batch-1 --url https://www.xiaohongshu.com`: 成功

## 2. 手动流程验证结果（按 unified operation 顺序）

| Operation | 手动验证动作（camo CLI） | 结果 | 结论 |
|---|---|---|---|
| `sync_window_viewport` | `camo viewport` + `camo window resize` | 可执行，但 window->viewport 同步后出现超大 viewport（3632x1878） | ⚠️ 部分通过 |
| `goto_home` | `camo start ... --url https://www.xiaohongshu.com` | 成功进入主页 | ✅ 通过 |
| `fill_keyword` | `camo click '#search-input'` + `camo type '#search-input' '工作服定制'` | 成功 | ✅ 通过 |
| `submit_search` | `camo click '.input-button .search-icon'` | 成功进入结果流 | ✅ 通过 |
| `open_first_detail` | `camo click '.note-item a.cover'` | 成功打开详情，但直接跳转详情 URL，不是页内 modal | ⚠️ 部分通过（模型偏差） |
| `detail_harvest` | `camo scroll --down --amount 380` * 3 | 成功滚动，详情元素可见 | ✅ 通过 |
| `expand_replies` | `camo container filter '.show-more'` + `camo click '.show-more'` | 某些详情有 `.show-more`，某些没有（直接报 Element not found） | ⚠️ 部分通过 |
| `comments_harvest` | `camo container filter '.comment-item' '.comments-container'` | 评论容器与评论项可稳定识别 | ✅ 通过 |
| `comment_match_gate` | 无等价单命令（依赖 runtime 内部状态） | 仅能确认评论文本存在 | ⚠️ 待运行态验证 |
| `comment_like` | `camo click '.comment-item .like-wrapper'` | 失败：`Element not found`（当前页面结构无 `.like-wrapper`） | ❌ 失败 |
| `comment_reply` | 脚本已禁用 | 未执行 | ⏭️ 跳过 |
| `close_detail` | `camo back` / `camo click 'a[href*="/explore?channel_id=homefeed_recommend"]'` | `back` 无效；点击发现后 URL 变化，但 `container filter` 仍可见 `.note-scroller` | ❌ 失败（disappear 判定风险高） |
| `wait_between_notes` | 手动等待 | 可执行 | ✅ 通过 |
| `ensure_tab_pool` | `camo new-page ...` | 连续失败：`new_tab_failed` | ❌ 失败 |
| `switch_tab_round_robin` | `camo switch-page 1/2` | 因无新 tab，报 `invalid_page_index` | ❌ 失败（被前置阻塞） |
| `open_next_detail` | 依赖 tab 轮转后继续开详情 | 被 `ensure_tab_pool` 阻塞 | ❌ 未通过（前置阻塞） |
| `abort_on_login_guard` | `camo container filter '.login-container'` | 未触发 | ✅ 通过（本次无守卫） |
| `abort_on_risk_guard` | `camo container filter '.qrcode-box'` | 未触发 | ✅ 通过（本次无守卫） |
| `verify_subscriptions_all_pages` | 依赖多 tab + 跨页 selector 校验 | 被 `new_tab_failed` 阻塞 | ❌ 未通过 |

## 3. 关键发现（阻塞自动化）

1. 详情打开形态与脚本抽象不一致
- 实际行为是跳转到详情 URL（`/explore/<noteId>...`），非稳定页内 `detail_modal`。
- 当前编排大量依赖 `detail_modal exist/disappear`，容易触发错误链路。

2. 关闭详情判定不可靠
- `back` 在本次详情页无效。
- 点击 `discover` 后 URL 回到 `explore`，但 DOM 仍可匹配 `note-scroller/comments-container`，会影响 `disappear` 触发准确性。

3. 多 tab 能力当前不可用
- `camo new-page` 持续返回 `new_tab_failed`。
- 直接阻塞 `ensure_tab_pool -> switch_tab_round_robin -> verify_subscriptions_all_pages`。

4. 点赞选择器失配
- `xhs_comment_like` 当前依赖 `.like-wrapper`，实测目标页面未匹配到。

## 4. 证据文件

目录: `docs/verification/evidence/xhs-unified-manual-2026-02-16`

- `01-home.png`
- `02-search-results.png`
- `03-detail-opened.png`
- `04-detail-scrolled.png`
- `05-back-to-search.png`
- `06-close-detail-via-discover.png`
- `07-detail-opened-second.png`

## 5. 自动化就绪结论

当前 **不满足** “可完整走自动化脚本”的条件，至少需要先修复以下阻塞项：

1. 将 detail 流程从“modal 假设”改为“URL 详情页/混合模式”可兼容触发模型。
2. 修复 `new-page` 能力（否则 tab pool/轮询编排不可用）。
3. 更新点赞选择器策略（从固定 `.like-wrapper` 改为多选择器或结构化定位）。
4. 为 `close_detail` 增加可靠的“页面状态退出判定”（不仅看 URL，需加可见性约束）。

## 6. 第二轮修复后复核（同日）

### 6.1 已实现修复

1. `xhs_open_detail`:
- 强制“点击进入”路径，点击后等待详情页/详情容器动画完成（`DETAIL_OPEN_TIMEOUT` 超时保护）。

2. `xhs_close_detail`:
- 改为优先 `Esc` 退出（多次尝试）并等待动画结束。
- 仅在 `Esc` 失败时尝试详情内关闭按钮，不再依赖 `discover` 跳转或 `history.back`。

3. `xhs_comment_like`:
- 增加“无评论项则直接跳过”保护。
- 点赞控件改为多候选定位，若未找到控件返回 `no_like_control`，不做危险操作。

4. unified 模板:
- `detail_modal` 订阅扩展到真实详情 DOM（含 `.note-scroller/.note-content/.interaction-container/.comments-container`）。
- `close_detail` post 校验收紧为 `home_ready/search_ready`（要求确实离开详情态）。

### 6.2 Esc 退出专项验证（camo autoscript run）

- 验证脚本: `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-esc-close-check.autoscript.json`
- 执行日志: `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-esc-close-check.run.log`
- 结果:
  - `open_first_detail` 成功
  - `close_detail` 成功
  - 观测到 `detail_modal.disappear` 事件
  - 终止码 `AUTOSCRIPT_DONE_ESC_CLOSE_CHECK`

### 6.3 多页面点赞位检查（3 个详情页）

证据目录: `docs/verification/evidence/xhs-unified-manual-2026-02-16/multipage-like-check`

- 第 1 页: `comment-item`=10，未定位到点赞控件选择器
- 第 2 页: `comment-item`=2，未定位到点赞控件选择器
- 第 3 页: `comment-item`=1，未定位到点赞控件选择器

结论:
- “有评论不等于一定有可点击点赞控件”已被验证，当前策略改为“找不到控件即跳过”是必要保护。

### 6.4 当前剩余阻塞

1. `new-page` 仍返回 `new_tab_failed`（tab pool 与轮转链路仍被阻塞）。

## 7. 最小 unified 脚本实跑（关键词评论+点赞）

### 7.1 脚本与目标

- 脚本: `autoscripts/xiaohongshu/unified-min-comment-like.autoscript.json`
- profile: `xiaohongshu-batch-1`
- 目标链路: `搜索 -> 点击进详情 -> 评论抓取 -> 条件点赞 -> Esc 退出 -> 脚本自动结束`

### 7.2 关键实现调整

1. 新增最小脚本 `unified-min-comment-like`，移除 tab pool 轮转，仅验证单轮主链路。
2. 为避免无评论时流程挂起，`comments_harvest/comment_match_gate/comment_like` 统一改为在 `detail_modal.exist` 触发并串行依赖。
3. 新增 `finish_script` 终止节点：
- `trigger: home_search_input.exist`
- `dependsOn: [close_detail]`
- `action: raise_error` with `AUTOSCRIPT_DONE_MINIMAL_FLOW_COMPLETE`

### 7.3 实跑结果（2026-02-16）

证据日志:
- `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-min-comment-like.run3.log`

关键事件（日志检索）:
- `open_first_detail` 启动: line 61
- `comment_like` 完成: line 91
- `close_detail` 启动并完成: lines 93 / 102
- `operation_terminal` with `AUTOSCRIPT_DONE_MINIMAL_FLOW_COMPLETE`: line 109
- `autoscript:stop` reason=`script_complete`: line 110

结论:
- 最小 unified 脚本已可在 `camo autoscript run` 下完整执行并自动退出。
- 运行日志显示详情打开、评论链路、点赞链路、关闭链路及终止链路全部触发。

## 8. 可视语义对齐验证（exist/appear/disappear）

- 对齐目标: 订阅事件改为“可视存在”语义，而非仅 DOM 存在。
- 实现点:
  - `src/utils/browser-service.mjs`: DOM snapshot 增加 `node.visible`（rendered + viewport + hit-test）
  - `src/container/change-notifier.mjs`: `findElements` 默认 `visible=true` 过滤，`visible=false` 可显式放开

### 8.1 实跑证据（2026-02-16）

日志: `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-min-comment-like.run4-visible.log`

关键行:
- line 68: `home_search_input.disappear`（详情打开后）
- line 70/71: `detail_modal.appear/exist`
- line 93: `close_detail` 完成
- line 94/95: `home_search_input.appear/exist`（关闭详情后重新可见）
- line 107/108: `AUTOSCRIPT_DONE_MINIMAL_FLOW_COMPLETE` + `script_complete`

结论:
- `exist/appear/disappear` 已按可视状态驱动，不再把“被模态遮挡但仍在 DOM”的元素当成存在。

## 9. 分层修复与回归（2026-02-16 晚）

### 9.1 runtime-core 分层修复

- 移除 runtime-core 内 `xhs_*` 业务硬编码分发，改为 autoscript 层 action provider 注入。
- runtime-core 仅保留通用 primitive（并增加 external executor hook）。

相关代码:
- `src/container/runtime-core/operations/index.mjs`
- `src/autoscript/action-providers/index.mjs`
- `src/autoscript/action-providers/xhs.mjs`

### 9.2 卡住问题定位与修复

现象:
- 在详情页中 `detail_modal.exist` 持续触发但后续 `close_detail` 不再被调度，脚本看起来“卡住”。

根因:
- `exist` 触发的去重 key 仅依赖 `appearCount`，在某些 close/open 节奏下会被永久去重抑制。

修复:
- 对 `once=false` 且配置了 pacing 的 `subscription.exist` 操作允许周期性重调度，避免 `close_detail` 饿死。

相关代码:
- `src/autoscript/runtime.mjs`

### 9.3 实机回归结果（camo autoscript run）

脚本:
- `docs/verification/evidence/xhs-unified-manual-2026-02-16/unified-harvest-workwear-8-clearstate.autoscript.json`

日志:
- `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-workwear-8-clearstate.run14.log`

关键统计（JSONL 汇总）:
- `goto_home` = 1
- `fill_keyword` = 1
- `submit_search` = 1
- `open_next_detail` = 8
- 终止码 = `AUTOSCRIPT_DONE_MAX_NOTES`
- `autoscript:stop.reason` = `script_complete`

结论:
- 已验证“首轮搜索后不重复搜索”，后续按 `open_next_detail` 连续推进并正常结束。
- 卡住问题在本轮回归中未复现。

## 10. 自动拉起 + unified 实跑联调（2026-02-16 晚）

### 10.1 WS daemon 自动拉起验证

步骤:
- 先杀掉当前 `:7788` 监听进程，再执行普通命令 `node src/cli.mjs profile list`。
- 随后检查 `http://127.0.0.1:7788/health`。

结果:
- 普通命令执行后，daemon 自动恢复监听（`node:<pid>`）。
- health 返回 `ok=true`。

证据:
- `docs/verification/evidence/xhs-unified-manual-2026-02-16/ws-daemon-autostart-check.run16.log`

### 10.2 unified 脚本实跑（目标 20，关键词=工作服定制）

执行:
- `node src/cli.mjs autoscript run autoscripts/xiaohongshu/unified-harvest-workwear.autoscript.json --profile xiaohongshu-batch-1`

日志:
- `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-workwear.run16.log`

关键结果:
- `runId`: `2d3567c1-1aaa-47ff-b15b-7f4a92264125`
- `goto_home` 完成次数 = 1
- `submit_search` 完成次数 = 1
- `open_next_detail` 完成次数 = 17
- 终止码: `AUTOSCRIPT_DONE_MAX_NOTES`
- 停止原因: `script_complete`
- 运行时长: `118398ms`

### 10.3 进度流验证（JSONL/WS）

结果:
- `events recent --limit 25` 可读取到本次 run16 的终止链路事件（`operation_terminal`/`autoscript:stop`/`autoscript.run_stop`）。
- `events tail` 可收到实时事件（含手动探针事件）。

证据:
- `docs/verification/evidence/xhs-unified-manual-2026-02-16/ws-tail-live-check.run16.log`

### 10.4 本轮发现的非阻塞问题

- `detail_harvest` 出现 `VALIDATION_FAILED (phase=post)`：16 次
- `comments_harvest` 出现 `VALIDATION_FAILED (phase=post)`：22 次
- 当前均按脚本策略继续推进（`RECOVERY_NOT_CONFIGURED`，impact=`none`），未阻断完成。

结论:
- 自动拉起 + unified 主流程已可稳定跑完并给出确定终止码。
- 但 `detail_harvest/comments_harvest` 的 post 校验仍存在较高失败率，需作为下一轮稳定性修复项。

## 11. run17 稳定性修复回归（2026-02-16 晚）

### 11.1 本轮修复

1. runtime 增加 stale trigger 守卫（基础能力）
- 文件: `src/autoscript/runtime.mjs`
- 新增 `isTriggerStillValid`，在执行前再次确认触发条件是否仍成立。
- 当触发失效时不执行操作，记录 `autoscript:operation_skipped`（`reason=stale_trigger`）。

2. unified 模板与脚本链路对齐（策略层）
- 文件: `src/autoscript/xhs-unified-template.mjs`
- 文件: `autoscripts/xiaohongshu/unified-harvest-workwear.autoscript.json`
- 调整点:
  - `detail_modal` 选择器对齐为更完整的详情容器集合。
  - `comments_harvest/comment_match_gate/comment_like/comment_reply` 触发从 `detail_comment_item.exist` 改为 `detail_modal.exist`。
  - 评论链路依赖恢复为 `detail_harvest -> comments_harvest -> comment_match_gate -> comment_like`。
  - `close_detail.dependsOn` 对齐为 `comment_like`（当前 doLikes=true）。
  - `detail_harvest/comments_harvest` 校验改为 `mode=both`，增加 pre 守卫。

3. 单测
- 新增 runtime 用例: stale trigger 下应跳过而非执行。
- 文件: `tests/unit/autoscript/runtime.test.mjs`

### 11.2 回归结果（run17）

- 日志: `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-workwear.run17.log`
- runId: `92816cc1-2637-40f6-9bb4-7609edcda195`
- 终止码: `AUTOSCRIPT_DONE_MAX_NOTES`
- 停止原因: `script_complete`
- `goto_home` = 1
- `submit_search` = 1
- `operation_skipped(stale_trigger)` = 6（安全跳过，不执行失效动作）

错误对比（run16 -> run17）:
- `detail_harvest` `VALIDATION_FAILED`: `16 -> 0`
- `comments_harvest` `VALIDATION_FAILED`: `22 -> 0`

结论:
- 已实现“无法定位/触发失效时不做操作”的运行时保障。
- unified 主流程保持可终止，且显著降低了详情关闭后的误执行噪音。

## 12. deepseek新模型 50条场景实跑（2026-02-16）

### 12.1 脚本参数

- 脚本: `autoscripts/xiaohongshu/unified-harvest-deepseek-50.autoscript.json`
- profile: `xiaohongshu-batch-1`
- keyword: `deepseek新模型`
- maxNotes: `50`
- 评论抓取: 开启（`doComments=true`）
- 点赞关键字: `骄傲`（`matchKeywords/likeKeywords = ["骄傲"]`）

### 12.2 实跑结果（run18）

- 日志: `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-deepseek-50.run18.log`
- runId: `ae9d7801-51d5-4ff1-b653-2d7f05c5fd15`
- 终止码: `AUTOSCRIPT_DONE_MAX_NOTES`
- 停止原因: `script_complete`

关键统计:
- `goto_home`=1
- `submit_search`=1
- `open_first_detail`=1
- `open_next_detail.done`=28（外加 terminal 结束 1 次）
- `comments_harvest.done`=23
- `comment_like.done`=29
- `operation_skipped(stale_trigger)`=77

### 12.3 关注点

- 本轮仍出现少量 pre 校验失败（转场窗口期）:
  - `detail_harvest`: 3 次
  - `comments_harvest`: 6 次
- 脚本仍可按策略继续并最终完整结束。

## 13. deepseek新模型 50条复跑（run23，2026-02-16）

### 13.1 本轮修复点

- 运行时依赖满足条件调整:
  - 文件: `src/autoscript/runtime.mjs`
  - 变更: `dependsOn` 在 `status in {done, skipped}` 时视为满足，避免 stale skip 后链路卡死。
- unified 模板时序重排:
  - 文件: `src/autoscript/xhs-unified-template.mjs`
  - 变更:
    - `wait_between_notes/ensure_tab_pool/verify_subscriptions_all_pages` 触发统一改为 `search_result_item.exist`，规避 `detail_modal.disappear` 与 `close_detail` 完成先后竞态。
    - `comments_harvest` 参数提升为更强“到底部优先”策略: `maxRounds=48, scrollStep=360, settleMs=260, stallRounds=8, requireBottom=true`。
    - `detail_show_more` 订阅改为详情容器内选择器，`expand_replies` 新增 `detail_modal` 存在条件。
    - `close_detail` 依赖对齐为 `comment_match_gate`（点赞/回复阶段不再成为关闭唯一阻塞）。
- XHS action provider 优化:
  - 文件: `src/autoscript/action-providers/xhs.mjs`
  - 变更: 评论抓取增加二次滚动推进和 `stalledScrollRounds` 判定，减少误判停滞。

### 13.2 实跑结果（run23）

- 日志: `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-deepseek-50.run23.log`
- runId: `3c5f80f5-11c3-4276-8a90-57529d0656e5`
- 终止码: `AUTOSCRIPT_DONE_MAX_NOTES`
- 停止原因: `script_complete`
- 最高进度: `open_next_detail.visited = 50`

关键计数:
- `operation_error = 0`
- `operation_skipped = 0`
- `comments_harvest.done = 50`
- `close_detail.done = 50`

退出原因分布（`comments_harvest.exitReason` 与 `close_detail.pageExitReason` 一致）:
- `bottom_reached`: 42
- `max_rounds_reached`: 8

`reachedBottom` 分布:
- `true`: 42
- `false`: 8

结论:
- 本轮已验证 50 条目标完整跑通，且不存在校验错误与 stale skip 噪音。
- 4-tab 轮询链路（`ensure_tab_pool -> switch_tab_round_robin -> open_next_detail`）在全程稳定执行。
- 对“每条详情退出必须有原因、并记录是否到底部”的要求已满足（50/50 均有结构化记录）。

## 14. 卡住样本现场复盘（不跳过，2026-02-16）

目标: 对 `run27` 中 `max_rounds_reached` 样本做手动现场复盘，卡住时不跳过，直接停留页面排查根因。

样本:
- noteId: `698ef7a90000000015022d73`
- URL: `https://www.xiaohongshu.com/explore/698ef7a90000000015022d73?xsec_token=ABbWFTeB5Rvcj_bwXGI1Q4Y-2PKvdXl4XmkAMlER6MafU=&xsec_source=pc_search&source=web_explore_feed`
- 预期评论数（页内显示）: `共 1070 条评论`
- run27 记录: `collected=111`, `exitReason=max_rounds_reached`, `rounds=48`, `recovered=0`

执行方式（严格按“无危险动作”）:
- 不刷新页面
- 不重新发起搜索
- 不新开详情
- 仅在当前详情评论区连续手动滚动（`camo mouse wheel`）

证据截图:
- 初始现场: `docs/verification/evidence/xhs-unified-manual-2026-02-16/manual-stuck-note-before-scroll.png`
- 等效 48 轮后仍未到底: `docs/verification/evidence/xhs-unified-manual-2026-02-16/manual-stuck-note-after-hover-wheel48-total.png`
- 继续滚动后最终到底（出现 `- THE END -`）:
  `docs/verification/evidence/xhs-unified-manual-2026-02-16/manual-stuck-note-after-hover-wheel408-total.png`

结论:
- 该场景不是“到底判定错误”，而是高评论量帖子在当前轮数预算下未滚完，导致 `max_rounds_reached`。
- `recoveries=0` 的原因是滚动过程持续有位移，未触发现有 `noEffectStreak` 恢复分支。
- 需要在策略层补强“高评论量自适应轮数预算 + 无新增评论触发回滚”，否则 1k+ 评论帖子仍会出现非到底退出。

## 15. 策略增强落地（recovery v3）

代码变更:
- `src/autoscript/action-providers/xhs.mjs`
  - `xhs_comments_harvest` 增加 `no-new-comments` 回滚触发（`recoveryNoProgressRounds`）。
  - 保留 `no-effect` 回滚触发；结果新增 `recoveryReasonCounts`，区分触发来源。
  - 增加 `expectedCommentsCount` 驱动的自适应轮数预算，结果新增:
    - `configuredMaxRounds`
    - `maxRounds`
    - `maxRoundsSource`
    - `budgetExpectedCommentsCount`
  - 自适应策略仅在“估算轮数 > 配置轮数”时扩容，避免低评论帖子无谓拉长。
- `src/autoscript/xhs-unified-template.mjs`
  - `comments_harvest.params` 默认增加:
    - `recoveryNoProgressRounds=3`
    - `adaptiveMaxRounds=true`
    - `adaptiveExpectedPerRound=10`
    - `adaptiveBufferRounds=16`
    - `adaptiveMinBoostRounds=24`
    - `adaptiveMaxRoundsCap=220`
- `tests/unit/autoscript/xhs-unified-template.test.mjs`
  - 新增上述模板参数断言。

测试:
- `node --test tests/unit/autoscript/xhs-unified-template.test.mjs tests/unit/autoscript/runtime.test.mjs`
  - 结果: 全部通过。

在线最小验证（maxNotes=1）:
- 脚本: `autoscripts/xiaohongshu/unified-harvest-deepseek-1-adaptive.autoscript.json`
- 日志:
  - `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-deepseek-1-adaptive.run2.log`
  - `docs/verification/evidence/xhs-unified-manual-2026-02-16/xhs-unified-harvest-deepseek-1-adaptive.run2.jsonl`
- `comments_harvest` 结果字段已生效:
  - `exitReason=bottom_reached`
  - `configuredMaxRounds=48`
  - `maxRounds=48`
  - `maxRoundsSource=configured`
  - `recoveryReasonCounts={no_effect:0,no_new_comments:0}`

说明:
- 上述最小验证用于确认“字段与策略逻辑生效”。
- 针对 `1070` 评论卡点样本的专项复测和 50 条复跑，归入下一阶段验收任务执行。
