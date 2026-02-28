# Hacker News API 参考

官方文档：https://github.com/HackerNews/API

## 基地址

```
https://hacker-news.firebaseio.com/v0
```

所有请求均为 GET，返回 JSON，无需认证。

## 列表端点

返回 item ID 数组（最多 500 个），按排名排序。

| 端点 | 说明 |
|------|------|
| `/topstories.json` | 当前排行最高的 stories |
| `/newstories.json` | 最新 stories |
| `/beststories.json` | 历史最佳 stories |
| `/askstories.json` | Ask HN |
| `/showstories.json` | Show HN |
| `/jobstories.json` | 招聘信息 |

示例：

```
GET /topstories.json
→ [41895451, 41894843, 41893831, ...]
```

## 获取单个 Item

```
GET /item/:id.json
```

返回字段：

```json
{
  "id": 41895451,
  "type": "story",
  "by": "username",
  "title": "Example Title",
  "url": "https://example.com/article",
  "text": "",
  "time": 1709136000,
  "score": 256,
  "descendants": 142,
  "kids": [41895500, 41895501]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 唯一 ID |
| `type` | string | `story`, `comment`, `job`, `poll`, `pollopt` |
| `by` | string | 作者用户名 |
| `title` | string | 标题 |
| `url` | string | 文章链接（Ask HN 等可能为空） |
| `text` | string | HTML 正文（self-post 内容） |
| `time` | number | Unix 时间戳 |
| `score` | number | 点数 |
| `descendants` | number | 评论总数（递归） |
| `kids` | number[] | 直接子评论 ID 列表 |

## 获取用户信息

```
GET /user/:username.json
```

## 实时更新

```
GET /updates.json
```

返回最近变更的 items 和 profiles。

## 项目中使用的方式

1. 请求列表端点获取 ID 数组（取前 `limit` 个）
2. 并发请求 `/item/:id.json` 获取详情（8 并发）
3. 每个请求 8 秒超时，失败跳过

## 参考链接

- [HN API 官方文档](https://github.com/HackerNews/API)
- [Hacker News](https://news.ycombinator.com)
