# AGENTS.md

## 项目约束

1. 代码分析优先使用 `lsp-code-analysis` skill（语义导航、定义/引用查找、符号级理解），并遵循其前置步骤：先执行 update 脚本，再执行 `lsp server start <project_path>`。
2. 项目任务管理统一使用 `bd`，包括任务创建、拆解、状态更新与关闭，避免多套任务源并行导致状态不一致。
3. **仓库边界（强制）**：
   - `camo` 仓库路径：`~/Documents/code/camo`（当前仓库）。
   - `webauto` 仓库路径：`~/Documents/github/webauto`。
   - `camo` 只承载通用能力（runtime/会话/路径解析/CLI 基础设施），不承载具体业务编排与平台策略（如 XHS 业务流程、点赞/评论业务规则）。
   - 具体业务逻辑必须落在 `webauto`，不要把 `webauto` 业务代码合并回 `camo`。
   - 跨仓库发布顺序：先发 `@web-auto/camo`，再发依赖该版本的 `@web-auto/webauto`。
4. **执行链路约束（强制）**：
   - `webauto` 的用户操作必须统一基于 `camo CLI / camo runtime`，禁止旁路实现。
   - 禁止 hack 行为：禁止 DOM `click()`、JS `scrollTo/scrollBy`、`history.back`、`value=` 注入输入等。
   - 操作必须基于容器与订阅事件驱动（`appear/exist/disappear`），并执行视口过滤，仅对可见容器操作。
   - 用户动作必须严格串行：同一 `profile` 任意时刻只允许 1 个 in-flight 动作（mouse/keyboard/click/type/scroll/back/switchPage 等）；禁止并发动作，避免高风控行为。
   - 若能力缺失，先在 `camo` 补齐能力并发布，再由 `webauto` 接入；禁止在 `webauto` 临时回退实现。
5. **统一业务流程（强制）**：
   - 所有平台统一为：`账号有效性检查 -> 链接列表采集 -> 帖子逐条处理`。
   - 帖子处理必须独立：每条帖子单独采集内容/评论与点赞等动作。
   - 登录无效直接阻断，不允许推进到链接采集或帖子处理阶段。
6. **兜底策略（强制）**：
   - 除非用户明确要求，不做兜底。
   - 团队硬约束原文：`兜底死全家`。


我们遇到 camo 的问题不要走回退或则加 patch，要找原因，解决问题
