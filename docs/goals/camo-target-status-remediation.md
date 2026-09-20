# camo Target / Status / Lifecycle 整改任务

状态：`READY_FOR_GCM`

日期：2026-09-19

主线：把 camo 从 `profileId` 驱动的隐式当前页面，收敛为 `target` 驱动、可观测、可回收的通用 runtime。

## 1. 基线与边界

- 实现基线：最新 `origin/main`。
- 当前本地 `main` 比 `origin/main` ahead 1；本地提交不隐式带入本任务。
- 独立 worktree：`playground/camo-target-status-remediation-gcm`。
- camo 只承载 runtime、session、路径、CLI、daemon 和通用页面能力。
- XHS、点赞、评论、帖子编排、平台 selector 属于调用方，不得进入 camo。
- 不允许 DOM `click()`、JS `scrollTo/scrollBy`、`value=` 注入、无条件 fallback、旧 v1 链复活或 silent success。
- 不在当前 `main`、dirty main 或既有 worktree 上开发。
- worker 不得 merge、push、生产安装、重启既有 daemon、删除既有 worktree 或终止非本轮进程。

## 2. 目标契约

```text
camo start --url https://example.com  -> { target }
camo click --target t_x --selector ...
camo type --target t_x --selector ... --text ...
camo status
camo status --profile default
camo status --target t_x
```

### 资源语义

- `profile`：账户身份与持久数据边界。
- `session`：一次 browser runtime generation。
- `target`：调用方唯一操作句柄。
- `page`：target 绑定的内部稳定页面资源。
- `profileId`、`sessionId`、`pageId`、generation：内部控制字段，不能冒充外部任务句柄。

### 模式语义

- `default`：普通调用默认使用，持久复用登录态。
- `temp`：明确无状态任务，任务期间复用，结束回收。
- `ephemeral`：内部可丢弃资源属性，不作为 Agent 的第三种业务模式。

### 硬行为

- 普通浏览器命令需要时自动发现或启动 daemon。
- `status` 只读：不启动 daemon/browser，不修复环境，不刷新 idle 时间。
- `start` 无 URL 不导航，不把已有页面改成 `about:blank`。
- `start` 有 URL 只导航本次分配的 target。
- 多 target 时无 target 不猜最新页、前台页或数组下标，返回明确歧义错误。
- target 绑定 session generation；session/daemon 重启后旧 target 明确失效。
- 同一 profile 的用户动作严格串行；排队或拒绝必须在契约中明确并可由 status 观察。
- 错误保持 typed error chain；不能用日志、snapshot、payload 反推控制真相。

## 3. 任务树

### T0 — 契约冻结与基线分类（P0）

- [ ] 写明 target、status、mode、cleanup、并发、兼容性契约。
- [ ] 决定旧 `--profile` action 兼容策略；推荐：target 主接口，profile 仅作确定性筛选。
- [ ] 决定同 profile 并发是排队还是拒绝；推荐：daemon 内显式串行队列。
- [ ] 分类 business 测试失败：旧 CLI 契约、测试隔离、产品真实回归。
- [ ] 建立 registry/function/verification owner 映射。

完成条件：没有未定义的 target 解析、失效、回收和错误语义。

### T1 — target/session 唯一 owner（P0）

推荐 owner：`v2/services/session`。

- [ ] 增加 target allocate / resolve / list / invalidate。
- [ ] target 绑定 profile、session instance、generation、stable pageId。
- [ ] session stop / daemon restart 使 target 失效。
- [ ] 收敛 `profileId -> current tab index` 的隐式 owner。
- [ ] 更新 `resources.json`、`modules.json`、edges、function map、feature tests。

完成条件：不存在第二套 target/page/session 真源。

### T2 — `status` 只读投影（P0）

- [ ] 注册 `status` CLI 命令。
- [ ] 支持全量、`--profile`、`--target` 过滤。
- [ ] 返回 service、profiles、targets、execution、reclamation、errors。
- [ ] daemon 不可达时显式返回 unavailable。
- [ ] 证明连续 status 不改变 session 更新时间、idle 时间、页面 URL 或进程数量。

完成条件：`status` 成为唯一用户状态入口；`daemon status` 保持低层进程诊断语义。

### T3 — 自动准备与 `start`（P0）

- [ ] default 自动准备，禁止无授权切到 temp。
- [ ] temp 在任务期间复用同一 session/target。
- [ ] start 返回 target。
- [ ] 删除已有 session 分支中的无条件 `about:blank` 导航。
- [ ] URL 只作用于本次 target。

完成条件：start/普通 action/status 行为满足上方硬行为矩阵。

### T4 — browser action 全量迁移（P1）

范围：goto、back、forward、reload、click、type、scroll、hover、snapshot、screenshot、evaluate、wait、query、cookies、viewport、user-agent、tab 操作、multi-open。

- [ ] CLI 对外传 target。
- [ ] daemon 统一解析 target。
- [ ] page runtime 使用内部 page handle，不复制 resolver。
- [ ] tab 操作返回稳定 target/page 信息，不暴露可变数组下标作为真相。
- [ ] 保持每 profile 串行和真实错误传播。

完成条件：两个 target 可隔离导航、输入、读取、关闭；旧 target 失效明确。

### T5 — 回收、异常、文档和调用方迁移（P1/P2）

- [ ] 区分 close browser/page 与 delete temp profile 数据。
- [ ] cleanup 失败进入显式 pending cleanup。
- [ ] 结果未知、stale lock、stale registration 可观察。
- [ ] 同步 README、service README、command docs、migration contracts、verification docs。
- [ ] 更新 camoufox skill，删除不再需要的手动 daemon 准备步骤。
- [ ] 调用方迁移到 target；业务编排仍留在调用方。

## 4. 允许路径

首轮 worker 允许修改：

- `v2/contracts/`
- `v2/commands/`
- `v2/shell/cli/`
- `v2/shell/daemon/`
- `v2/services/session/`
- `v2/services/browser_service/`
- `v2/services/page_runtime/`
- `v2/resources/registry/`
- `v2/tests/`
- 与本任务直接对应的 `v2/docs/`、`README.md`、`v2/README.md`

首轮禁止修改：

- `src/` 或任何已删除的 v1 链。
- OneStop、zterm、XHS 等外部业务仓库。
- 生产 daemon、全局安装目录、用户 profile 数据。
- 现有 worktree、他人分支、远程仓库。

## 5. 验证与交付

候选至少运行：

```bash
npm run test:v2
npm test
npm run test:all
npm run gates
npm run check:file-size
npm pack --dry-run --json
```

必须新增或补齐：

- target 唯一性、generation 失效、多 target 歧义；
- status 无副作用；
- start 无 URL 不导航；
- start URL 只作用于目标页面；
- default/temp 生命周期；
- 同 profile 串行/排队；
- installed package 真实 CLI replay。

候选完成 iff：

1. 主线 contract、唯一 owner、focused tests、integration tests 完成；
2. candidate review PASS；
3. worker 回报 candidate SHA、修改文件、测试摘要、未完成项和资源清理；
4. 不宣称 merge、push、安装、重启、OTA 或 live acceptance，除非对应证据已取得。

## 6. GCM worker goal prompt

下面提示词用于新的 `codex exec --profile gcm` worker。worker 不继承父 transcript，只读取当前 worktree 和本文件。

```text
目标：在 camo 仓库完成 Target / Status / Lifecycle 整改主线，先把 profileId 驱动的隐式页面操作收敛为 target 驱动、可观测、可回收的通用 runtime。

输入版本：当前 worktree 必须从最新 origin/main 建立；不要带入父分支未确认提交。

范围：只修改本任务文档允许路径。优先完成 T0-T3，再按剩余时间推进 T4；不要把 XHS、点赞、评论、帖子编排等业务放入 camo。

硬约束：
- target 是唯一外部操作句柄；内部可保留 profileId/sessionId/pageId/generation，但不得把数组下标或“当前页”当稳定句柄。
- services/session 是 target/session 唯一 owner；不要新建第二套 registry。
- status 必须只读，不启动 daemon/browser，不修复环境，不刷新 idle，不从日志或 payload 重建控制真相。
- 普通命令需要时自动发现或启动 daemon；default 是普通默认 profile；temp 是任务期间复用的临时资源；ephemeral 只作为内部属性。
- start 无 URL 不导航，不把已有页面改为 about:blank；有 URL 只导航本次 target。
- 同 profile 动作严格串行；排队/拒绝语义必须显式并可观察。
- 不做 fallback、silent success、旧 v1 链复活、DOM click、JS scrollTo/scrollBy、value= 注入。
- 保留真实错误链和现有通用能力；不修改外部业务仓库、生产运行位置、用户 profile 数据、远程仓库。

首轮交付：
1. 冻结并实现 target/status/start 的最小主线；
2. 更新 contracts、registry、function/verification maps 和 focused tests；
3. 迁移至少 start、status、goto、click、type、snapshot 的 target 路径；
4. 为多 target、stale target、无 URL start、status 无副作用、同 profile 串行增加测试；
5. 若发现旧 business 测试与当前契约冲突，先分类并报告，不用兼容 patch 伪装通过。

测试：
npm run test:v2
npm test
npm run test:all
npm run gates
npm run check:file-size
npm pack --dry-run --json

完成 iff：代码在本 worktree 形成可审查 candidate；测试结果真实；回报 candidate SHA（若提交）、修改文件、验证摘要、剩余风险、未完成 T 项、创建的进程/临时文件/日志及清理结果。不要 merge、push、安装全局包、重启既有 daemon 或宣称 live acceptance。

回报格式：
- 结论：PASS / INCOMPLETE / BLOCKED
- 首次偏离与根因
- owner 与修改文件
- candidate/tree identity
- 测试命令和精确结果
- 未完成、风险、需要主脑决策
- 资源清理证据
```
