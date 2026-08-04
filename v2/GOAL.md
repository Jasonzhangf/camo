# camo v2 — 完整剩余工作 Goal 提示词

## 总体目标

完成 camo v2 从"架构骨架 + registry 门禁"到"生产可用 CLI 工具"的剩余工程。核心交付物：`camo <cmd>` 从 CLI 启动 daemon（或找到已有 daemon），通过 WS 发送命令，daemon 驱动真实 Camoufox 浏览器，返回结果，优雅释放资源。

## 硬约束

1. 不走回退/降级/兜底。daemon 不可用就报错，不搞 fake transport。
2. 所有错误通过 CamoError + codes.json 投影，不 throw inline message。
3. registry 门禁保持通过（`node v2/gates/run-all.mjs --strict` 全绿）。
4. npm test 全绿。
5. 每次变更后执行 `npm pack --dry-run` 确认 v2/ 文件被打包。
6. 禁止 pkill/killall/kill $(...) 等 broad kill 命令。
7. 每个 stage 提交前跑 `npm test && node v2/gates/run-all.mjs --strict`。

---

## Stage 8: Daemon 端口冲突 + 端口发现机制

### 8a — 动态端口分配

**问题**: daemon 硬编码 WS=8765, HTTP=8766，多实例时端口冲突。

**目标**: daemon 支持端口 0（OS 分配），同时支持通过环境变量指定。

修改 `v2/shell/daemon/index.mjs`:

- WS_PORT 默认 0（让 OS 分配），HTTP_PORT 默认 0
- 启动后在 `listening` 回调中读取 `wss.address().port` 和 `server.address().port`
- 将实际端口写入 `~/.camo/daemon/<daemon_id>.json`（含 pid, wsPort, httpPort, profile, mode, startedAt）
- 支持 `CAMO_WS_PORT` / `CAMO_HTTP_PORT` 环境变量覆盖

### 8b — 端口冲突优雅处理

- HTTP server 和 WS server 的 `error` 事件监听 `EADDRINUSE` / `EACCES`
- 如果端口冲突：打印错误到 stderr，退出码 2，不静默吞异常
- 如果端口 0 冲突（理论上不会，但防御性处理）：同样退出

### 8c — CLI 端口发现

修改 `v2/shell/config/loader.mjs`:

- 新增 `daemonDiscovery` 函数：扫描 `~/.camo/daemon/` 目录，找最近活跃的 daemon
- 读取 daemon 的 JSON 文件，检查 pid 是否存活（`process.kill(pid, 0)`）
- 返回活跃 daemon 的 wsUrl
- 如果没找到活跃 daemon，返回 null（CLI 据此决定是否自动启动 daemon）

修改 `v2/shell/bin_entry/index.mjs`:

- `makeWsTransport()` 先尝试发现已有 daemon
- 如果没找到 daemon，自动启动一个 daemon 进程（`child_process.spawn`）
- 等待 daemon 就绪（轮询 `~/.camo/daemon/` 目录，超时 10s）
- 连接 WS 发送命令
- 命令完成后：如果是 ephemeral 模式，关闭 daemon

### 8d — 新增错误码

在 `v2/contracts/error_envelope/codes.json` 新增:

```json
{"code": "E_BROWSER_LAUNCH_FAILED", "category": "io", "default_user_message": "Failed to launch browser."},
{"code": "E_CONFIG_INVALID", "category": "input", "default_user_message": "Invalid configuration."},
{"code": "E_DAEMON_NOT_FOUND", "category": "state", "default_user_message": "Daemon not running."},
{"code": "E_DAEMON_START_FAILED", "category": "io", "default_user_message": "Failed to start daemon."}
```

### 验证

- `camo start` 在无 daemon 时自动启动 daemon，连接成功，返回 session
- `camo goto` 通过 WS 发送命令，daemon 响应
- 第二次 `camo start` 找到已有 daemon，不重复启动
- 端口冲突时 daemon 退出码 2，stderr 有明确消息
- 新增 error codes 有 unit test（正反）

---

## Stage 9: Ephemeral vs Persistent 会话模型

### 9a — Ephemeral 模式（默认）

- 不需要 profile 参数
- profileId 自动生成 `_ephemeral_<pid>_<timestamp>`
- 临时会话不使用持久 profile 目录；持久 profile 由 `camoufox_bridge.mjs` 统一管理
- 浏览器启动后执行命令，命令完成后关闭浏览器
- Daemon 在最后一个 ephemeral 命令完成后自动退出
- 临时浏览器数据目录在 daemon 退出时清理

### 9b — Persistent 模式（`--profile`）

- 需要指定 profile 参数
- 使用 profile 目录下的持久化 `userDataDir`
- 浏览器启动后保持运行，直到显式 `camo stop`
- 多命令共享同一个浏览器会话
- 支持 `--headless` 标志

### 9c — CLI 入口修正

修改 `v2/shell/bin_entry/index.mjs`:

- `--ephemeral` 标志：单命令模式，启动 daemon → 执行命令 → 关闭 daemon
- `--profile <name>` 标志：持久模式，daemon 保持运行
- 默认行为：`camo goto https://example.com` → ephemeral 模式
- `camo --profile work goto https://example.com` → 持久模式

### 验证

- `camo goto https://example.com` 自动启动 ephemeral daemon，执行后 daemon 退出
- `camo --profile work start` 启动持久 daemon
- `camo --profile work goto https://example.com` 复用已有 daemon
- `camo --profile work stop` 关闭浏览器，daemon 保持运行（或退出）
- 同时运行两个 ephemeral 命令互不干扰

---

## Stage 10: 完整 daemon 生命周期管理

### 10a — Daemon 优雅关闭

修改 `v2/shell/daemon/index.mjs`:

- SIGTERM/SIGINT 处理：
  1. 停止接受新连接
  2. 关闭所有浏览器（`camoufox_bridge.closeAll()`）
  3. 释放所有 profile lock
  4. 清理 ephemeral 临时数据目录
  5. 删除 daemon 注册文件（`~/.camo/daemon/<id>.json`）
  6. 关闭 WS 和 HTTP server
  7. 退出码 0

### 10b — 僵尸浏览器清理

- daemon 启动时扫描 `~/.camo/locks/` 目录
- 清理 stale lock（`lock/manager.mjs` 已有 `cleanupStale()`）
- 清理 stale daemon 注册文件
- 清理 ephemeral 临时数据目录

### 10c — 多 daemon 隔离

- 每个 daemon 实例有唯一 `daemon_id`
- daemon 注册文件包含 pid、端口、profile、启动时间
- 新 daemon 启动时检查是否已有同 profile 的活跃 daemon
- 冲突时退出（除非 `--force`）

### 验证

- `kill -TERM <daemon_pid>` → 浏览器关闭，lock 释放，注册文件删除
- 同时启动两个 daemon（不同 profile）互不干扰
- 同 profile 启动第二个 daemon → 退出码 2，提示已存在
- 清理 stale lock 不误删活跃 lock

---

## Stage 11: 缺失命令 + 服务接线

### 11a — 补充 daemon 缺失命令

在 `v2/shell/daemon/index.mjs` 的 `handleCommand` 新增:

- `back`: 浏览器后退（`page.goBack()`）
- `switchPage`: 切换标签页（通过 tab_pool）

### 11b — 服务接线

- `subscription/registry.mjs` → daemon WS 事件推送
- `container/matcher.mjs` → daemon 命令执行前容器匹配
- 新增 `v2/services/container/bridge.mjs` 作为 container 和 page_runtime 之间的桥梁

### 11c — 测试补充

- `v2/tests/unit/services/page_runtime.back.test.mjs`
- `v2/tests/unit/services/page_runtime.switchPage.test.mjs`
- `v2/tests/smoke/daemon.command.test.mjs`（daemon 真实命令循环）

---

## Stage 12: 打包 + CI + 发布

### 12a — npm pack 验证

- `npm pack --dry-run` 确认包含: `bin/`, `v2/`, `scripts/`, `README.md`, `LICENSE`
- `npm pack` 然后 `tar -xf <tgz>` 验证 v2 文件完整
- 从打包目录运行 `bin/camo --help` 验证可执行

### 12b — CI 增强

- `v2-registry-gates.yml` 增加 `npm test` 步骤（当前只有 unit）
- 增加 daemon smoke test（启动 daemon → 发 WS ping → 关闭 daemon）
- 增加 `npm pack` 验证步骤

### 12c — codex review 门禁

- 每次 Stage 完成后执行 codex review（hard guard 36）
- 修复 review 发现的 blocking findings
- 无 blocking findings 才可提交

---

## 执行顺序

```
Stage 8a (动态端口) → 8b (端口冲突) → 8c (端口发现) → 8d (错误码)
  → Stage 9a (ephemeral) → 9b (persistent) → 9c (CLI 入口)
    → Stage 10a (优雅关闭) → 10b (僵尸清理) → 10c (多实例隔离)
      → Stage 11a (缺失命令) → 11b (服务接线) → 11c (测试)
        → Stage 12a (打包) → 12b (CI) → 12c (review)
```

每个 Stage 完成后必须:
1. `npm test` 全绿
2. `node v2/gates/run-all.mjs --strict` 全绿
3. `npm pack --dry-run` 确认打包内容
4. 提交并写提交信息
