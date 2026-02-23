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
