# AGENTS.md

## 项目约束

1. 代码分析优先使用 `lsp-code-analysis` skill（语义导航、定义/引用查找、符号级理解），并遵循其前置步骤：先执行 update 脚本，再执行 `lsp server start <project_path>`。
2. 项目任务管理统一使用 `bd`，包括任务创建、拆解、状态更新与关闭，避免多套任务源并行导致状态不一致。
