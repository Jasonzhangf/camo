# Camo v2 浏览器搜索技能 Goal

## 状态: 进行中 (阶段1-4 核心模块已完成)

## 阶段 1: 架构对齐 (Openminis 参考) ✅

### 1.1 资源层抽象 ✅
- [x] `v2/resources/browser/BrowserPool.ts` - Tab 池管理
- [x] `v2/resources/browser/BrowserInstance.ts` - 单浏览器实例
- [x] 多浏览器实例彼此隔离
- [x] 全局 Tab 数量上限可配置 (globalTabCap=8)
- [x] Session 销毁时自动清理关联浏览器

### 1.2 Action 层抽象 ✅
- [x] `v2/core/browser/Actions.ts` - 21 个 Action 类型定义
- [x] 每个 Action 有类型安全的输入/输出
- [x] Action 执行结果包含 page_url, tab_id 等元数据

### 1.3 Cookie 生命周期管理 ✅
- [x] `v2/core/browser/CookieStore.ts` - Cookie 持久化
- [x] Netscape cookies.txt 格式支持
- [x] 30天 domain retention
- [x] Profile 隔离的 Cookie 存储

## 阶段 2: 搜索技能封装 ✅

### 2.1 搜索抽象层 ✅
- [x] `v2/services/search/SearchEngine.mjs` - 搜索抽象接口
- [x] 统一的搜索接口签名
- [x] 结果解析的泛型支持

### 2.2 平台实现 ✅
- [x] `v2/services/search/platforms/XHSSearch.mjs` - 小红书搜索
- [x] Cookie 注入方式
- [x] 结果解析 (笔记列表)

## 阶段 3: 生命周期治理 ✅

### 3.1 临时/持久任务模式 ✅
- [x] `v2/runtime/TransientBrowser.ts` - 临时浏览器 TTL/清理
- [x] `v2/runtime/PersistentBrowser.ts` - 持久浏览器 Profile 绑定
- [x] 无僵尸资源泄漏

### 3.2 资源监控 ✅
- [x] `v2/monitoring/ResourceMonitor.ts` - 全局资源快照
- [x] 诊断接口可用

## 阶段 4: 集成验证 🔄

### 4.1 Daemon 集成 ✅
- [x] search 命令已添加到 `command_handlers.mjs`
- [x] 浏览器命令可执行

### 4.2 待完成
- [ ] 运行集成测试
- [ ] 运行 E2E 测试
- [ ] Registry gate 验证

## 验收信号
- [x] `v2/core/browser/Actions.ts` - TypeScript 检查通过
- [x] `v2/resources/browser/BrowserInstance.ts` - Camoufox 封装
- [x] `v2/services/search/SearchEngine.mjs` - 搜索引擎
- [x] `v2/shell/daemon/command_handlers.mjs` - search 命令已注册
- [x] `camo search xhs "咖啡"` 返回结构化结果 (已验证, 含 title/url/author/timestamp/likes)
- [ ] `camo browser list` 显示隔离实例 (待验证)
- [ ] 临时任务超时后自动清理 (待验证)
- [ ] 持久任务跨命令保持状态 (待验证)

## 文件清单

| 类型 | 路径 | 状态 |
|------|------|------|
| Action 层 | `v2/core/browser/Actions.ts` | ✅ |
| Cookie 管理 | `v2/core/browser/CookieStore.ts` | ✅ |
| 资源层 | `v2/resources/browser/BrowserPool.ts` | ✅ |
| 资源层 | `v2/resources/browser/BrowserInstance.ts` | ✅ |
| 搜索核心 | `v2/services/search/SearchEngine.mjs` | ✅ |
| XHS 平台 | `v2/services/search/platforms/XHSSearch.mjs` | ✅ |
| 临时浏览器 | `v2/runtime/TransientBrowser.ts` | ✅ |
| 持久浏览器 | `v2/runtime/PersistentBrowser.ts` | ✅ |
| 监控 | `v2/monitoring/ResourceMonitor.ts` | ✅ |
| CLI 命令 | `v2/shell/daemon/command_handlers.mjs` | ✅ |

## 执行顺序
1. ✅ 阶段 1: 架构对齐
2. ✅ 阶段 2: 搜索技能封装
3. ✅ 阶段 3: 生命周期治理
4. 🔄 阶段 4: 集成验证
