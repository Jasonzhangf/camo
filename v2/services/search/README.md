# services-search

Module: `services.search` (active). See `v2/resources/registry/modules.json`.

搜索抽象层与平台实现。平台无关的搜索接口 + 小红书(XHS)/微博(Weibo)平台实现。

## 组成

- `SearchEngine.mjs` — 平台无关搜索接口：`SearchPlatform` 基类 + `SearchEngine` 管理器（注册/搜索/平台枚举）。
- `platforms/XHSSearch.mjs` — 小红书平台实现：登录检查(`ensureLoggedIn`)、导航搜索页、滚动加载、解析 `.note-item` 卡片，输出 `title/url/author/timestamp/likes`。
- `platforms/WeiboSearch.mjs` — 微博平台实现：登录检查(`ensureLoggedIn`)、导航 `s.weibo.com` 综合搜索、滚动加载、解析微博卡片，输出 `title/url/author/reposts/comments/likes`。

## 消费方

- `v2/commands/builtins/search/index.mjs` — CLI `camo search xhs|weibo <query>` 入口。
- `v2/shell/daemon/command_handlers.mjs` — daemon `search` 命令 handler。

## 测试

- 在线验证：`camo search xhs "咖啡" --max-results 5` 返回结构化结果(含 title/url/author/timestamp/likes)；`camo search weibo "咖啡"` 需已登录微博账号。
