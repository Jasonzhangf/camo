# OneStop Claw 线上浏览器验证阻塞记录

日期：2026-08-08（Asia/Shanghai）  
项目：`OneStop` canonical Claw（`https://claw.codewhisper.cc`）  
工具：全局安装的 `@web-auto/camo@0.4.2`

## 结论

OneStop canonical API 部署已可通过 HTTP 真实样本验证；camo 的真实浏览器验证目前被 camo runtime 的浏览器生命周期管理阻塞。阻塞不是 OneStop 页面或登录接口的业务错误，而是 camo daemon 在跨命令持久化浏览器状态时退出，随后页面被关闭/重置为 `about:blank`。请在 camo 仓库内修复根因并补齐回归测试后，再继续 OneStop 的 camo 线上验证。

## 已确认的 OneStop 线上状态

以下请求均针对 canonical Claw，不是本地实例：

```text
GET https://claw.codewhisper.cc/onestop/health
{"ok":true,"service":"onestop-api"}

GET https://claw.codewhisper.cc/onestop/api/account/auth/status
owner=backend
registrationEnabled=true
emailProvider=smtp
emailDeliveryConfigured=true
emailDeliveryStatus.ready=true
emailDeliveryStatus.verified=true
verifiedAt=2026-07-29T04:01:24.843Z

GET https://claw.codewhisper.cc/onestop/api/catalog/products
返回 3 个 listed 商品，来源为 published-resource-index.json

未登录访问管理接口：
GET /onestop/api/admin/catalog -> {"error":{"code":"admin_auth_required"}}
GET /onestop/api/admin/orders -> {"error":{"code":"admin_auth_required"}}
GET /onestop/api/admin/products -> {"error":{"code":"admin_auth_required"}}
```

远端 systemd 状态也已确认：

```text
onestop-api.service: active (running)
api listening on http://127.0.0.1:19190
/opt/onestop/current -> /opt/onestop/releases/20260808T061447Z-17781
```

## camo 复现步骤

全局安装已执行：

```bash
cd ~/github/camo
npm install -g . --force
which camo
# /opt/homebrew/bin/camo
camo --version
# 0.4.2
```

使用独立 profile：

```bash
export CAMO_AUTOSTART=1
export CAMO_PROFILE=onestop-test-fresh

camo goto https://claw.codewhisper.cc/onestop/admin
camo get-page-info
camo type adminadmin --selector 'input[name=password]'
camo click --selector 'button[type=submit]'
camo get-page-info
```

实际结果：

1. `goto` 成功，页面标题为 `OneStop 管理后台`。
2. `get-page-info` 在紧邻的独立命令中可读取页面。
3. `type` 返回 `typedChars: 10`，但页面内通过后续 `evaluate` 检查到密码值为空（需要确认是页面/输入操作问题还是命令间浏览器状态问题）。
4. `click --selector 'button[type=submit]'` 失败：

```text
E_BROWSER_CLICK_FAILED
locator.click: Timeout 10000ms exceeded
waiting for locator('button[type=submit]')
```

5. 点击失败后，同一 profile 的后续 `get-page-info` 返回 `about:blank`；对应 daemon registration 文件存在，但 daemon PID 已退出。

另一个典型错误：

```text
CAMO_PROFILE=onestop-canonical CAMO_AUTOSTART=1 camo goto ...
E_INTERNAL_UNEXPECTED
{"message":"browserState is not defined"}
```

## 已定位的 camo 代码问题

### 1. `browserState is not defined`（已在工作树临时修正，待你正式审查）

文件：`v2/shell/daemon/index.mjs`，原 `ensureBrowser()` 持久模式分支：

```js
if (!currentBrowserProfile) {
  await startSession(...);
  currentBrowserProfile = targetProfile;
  browserRefCount = 1;
  if (browserState) browserState.currentBrowserProfile = targetProfile;
}
```

`ensureBrowser()` 作用域内没有 `browserState` 变量；唯一状态对象是 `handleCommand()` 创建的 `_currentBrowserState`。因此首次浏览器命令会抛出 `ReferenceError: browserState is not defined`，再被投影成 `E_INTERNAL_UNEXPECTED`。

当前工作树已将这一行改为：

```js
if (_currentBrowserState) _currentBrowserState.currentBrowserProfile = targetProfile;
```

该修改仅是诊断用根因修复，尚未提交。

### 2. `handleCommand()` 的状态对象边界需要重新设计

文件：`v2/shell/daemon/index.mjs`。

原实现每个 command 都在 `try` 内重新创建局部对象：

```js
const browserState = { currentBrowserProfile, browserRefCount };
_currentBrowserState = browserState;
const result = await dispatchCommand(..., { browserState });
currentBrowserProfile = browserState.currentBrowserProfile;
```

风险：

- `ensureBrowser()` 依赖 `_currentBrowserState` 这一隐式全局侧通道，而 `dispatchCommand()` 同时接收显式 `browserState`；两个来源可能漂移。
- 正式实现必须只保留一个 owner 和一条状态传递链，不能通过未定义变量或隐式 fallback 修复。
- persistent mode 的状态应在 command 成功和失败路径上都有明确同步规则。

当前诊断工作树还将 `handleCommand()` 改为预先建立 `_bState` 并传入 `browserState: _bState`，但该改动尚未完成验证，请你审查是否应改为显式 `state` 参数传入 `ensureBrowser()`，从而彻底移除模块级 `_currentBrowserState`。

### 3. 浏览器命令的生命周期语义不一致

文件：`v2/shell/daemon/index.mjs`、`v2/shell/daemon/command_handlers.mjs`。

- `command_handlers.mjs` 只把 `goto/click/type/scroll/screenshot/snapshot/wait/evaluate/upload/select` 放入 `browserCmds`，这些命令会在 `handleCommand()` 前调用 `ensureBrowser()`。
- `get-page-info/get-readable/find-elements/get-text` 不在该集合中，依赖之前命令留下的 page；如果 daemon 已重启或 browser 被释放，会得到 `E_STATE_NOT_FOUND`。
- CLI 每个命令都是一次独立进程。只有 named profile 的 persistent daemon 才能跨命令保留浏览器；命令必须在同一存活 daemon 上执行。

请明确并测试：哪些命令是“需要自动创建 page”的命令，哪些命令是“只读现有 page、没有 page 就显式失败”的命令。不要在 CLI 层加静默重试或降级。

### 4. screenshot 的 `--path` 语义未贯通

CLI builtin `v2/commands/builtins/screenshot.mjs` 接收并返回 `path`，但 daemon handler 调用：

```js
await screenshot({ profileId: profile, fullPage: args.fullPage === true });
return { ok: true, screenshot: true, format: r.format, size: r.size };
```

`args.path` 没有传入 page runtime，响应 `saved` 也没有从 daemon 返回。因此：

```text
camo screenshot --path /tmp/claw-camo-test.png
=> {"saved":false}
```

且目标文件不会创建。需要在唯一 owner 层修复参数和响应契约，并加正反测试：路径有效时保存成功；路径非法/不可写时显式失败。

## 不应采取的处理

- 不要在 OneStop 调用方加入 DOM `click()`、`evaluate` 注入点击、手工浏览器 CDP 或脚本 fallback。
- 不要通过 CLI 自动重试、自动切换 profile、复用旧 daemon 或静默回退到另一个浏览器实例。
- 不要把这个问题归因于 OneStop 的登录接口；HTTP API 已通过 canonical 真实请求验证。
- 不要只以 `goto` 返回 `navigated:true` 作为浏览器验证完成标准；必须在同一持久 daemon 上完成页面读取、输入、点击和登录后页面状态检查。

## 建议的修复验证顺序

1. 先为 `browserState` 明确唯一 owner，消除 `ReferenceError` 和隐式模块级状态漂移。
2. 增加 daemon command 正反测试：首次 `goto`、连续 `get-page-info`、输入后读取值、点击后页面导航；daemon 存活与 daemon 退出都要有明确结果。
3. 修复 screenshot path 契约并测试实际文件存在性与失败路径。
4. 运行 camo 的完整 gates/tests，并重新全局安装：

   ```bash
   cd ~/github/camo
   npm run gates
   npm test
   npm install -g . --force
   ```

5. 再用新 profile 对 OneStop canonical 执行：

   ```bash
   camo goto https://claw.codewhisper.cc/onestop/admin
   camo get-page-info
   camo type ...
   camo click ...
   camo get-page-info
   ```

6. 只有同一 profile 的 daemon 在全流程中持续存活、登录页面成功导航、截图文件真实落盘后，OneStop 才能继续后续线上真实样本验证。

## 证据与日志位置

- camo daemon registration：`~/.camo/daemon/*.json`
- camo progress events：`~/.camo/progress/`
- OneStop canonical API：`https://claw.codewhisper.cc/onestop/health`
- OneStop canonical auth status：`https://claw.codewhisper.cc/onestop/api/account/auth/status`
- OneStop admin entry：`https://claw.codewhisper.cc/onestop/admin`

## 2026-08-08 收敛结果

本轮已在 camo 唯一 owner 层完成并验证以下修复：

1. `v2/shell/daemon/index.mjs` 消除持久模式首次命令中的未定义 `browserState` 引用。
2. `v2/shell/daemon/command_handlers.mjs` 将 `type` 的 `selector` 和 `screenshot` 的 `path` 透传到 page runtime。
3. `v2/services/page_runtime/operations/interaction_ops.mjs` 的 `type` 在提供 selector 时只用 locator 读取可见目标坐标，再通过 mouse `move/down/up` 聚焦并用 `keyboard.type()` 输入；click 同样只读取坐标并发送 mouse `move/down/up`。offscreen 目标通过 `mouse.wheel()` 进入视口，未使用 `locator.fill()`、`locator.click()` 或 JS 用户动作注入。
4. `v2/services/page_runtime/operations/query_ops.mjs` 支持截图路径写入，并返回 `saved`/`savedPath` 契约。
5. `v2/commands/builtins/daemon.mjs` 与 `v2/shell/bin_entry/index.mjs` 启动 daemon 时使用 detached child + `unref()`，保证 daemon 跨 CLI 命令持续存活。

验证证据：

```text
npm run gates                         PASS
npm test                              320/320 + 10/10 PASS
npm install -g . --force              completed; camo --version = 0.4.2

CAMO_PROFILE=onestop-verify
camo goto https://claw.codewhisper.cc/onestop/admin       navigated=true
camo type adminadmin --selector input[name=password]       typedChars=10
camo evaluate ... input[name=password].value               adminadmin
camo click --selector button[type=submit]                  clicked=true
camo get-page-info                                           url=https://claw.codewhisper.cc/onestop/admin
camo screenshot --path /tmp/onestop-camo.png                saved=true; file exists (171812 bytes)
```

后续协议收口还发现并纳入验证：scroll 的 canonical wire 字段是 `dx/dy`，type 的响应字段是服务端投影 `typedChars`，hover 与其他协议用户动作共用一个 browser-command 生命周期分类 owner。OneStop 订单/商品全流程仍需在最终全局安装版本的登录后页面逐项验证；本轮不改变 OneStop 业务代码。
