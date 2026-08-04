# `camo search` - 跨平台搜索

跨平台内容搜索，支持指定平台和 Cookie 认证。

## 用法

```bash
camo search <platform> <query> [--cookies <file>] [--max-results <n>]
```

## 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| platform | string | 是 | 目标平台 (如 `xhs`, `douyin`) |
| query | string | 是 | 搜索关键词 |
| --cookies | path | 否 | Cookie 文件路径 |
| --max-results | number | 否 | 最大结果数 (默认 20) |
| --profile | string | 否 | Profile ID (默认 `default`) |

## 示例

```bash
# 小红书搜索
camo search xhs "咖啡探店" --cookies ./cookies.txt

# 指定结果数
camo search xhs "深圳美食" --max-results 50
```

## 支持平台

- `xhs`: 小红书
