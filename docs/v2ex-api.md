# V2EX API 参考

## V1 API（无需认证）

基地址：`https://www.v2ex.com/api`

### 热门主题

```
GET /topics/hot.json
```

返回当前热门主题列表（约 10-20 条）。

### 最新主题

```
GET /topics/latest.json
```

返回最新发布的主题列表。

### 返回字段

```json
[
  {
    "id": 1234,
    "title": "主题标题",
    "url": "https://www.v2ex.com/t/1234",
    "content": "原始内容",
    "content_rendered": "<p>HTML 渲染内容</p>",
    "replies": 42,
    "created": 1709136000,
    "last_modified": 1709222400,
    "node": {
      "name": "python",
      "title": "Python"
    },
    "member": {
      "username": "testuser"
    }
  }
]
```

---

## V2 API（需要 Token）

基地址：`https://www.v2ex.com/api/v2`

### 认证

在 [V2EX 设置页](https://www.v2ex.com/settings/tokens) 创建 Personal Access Token，然后通过 Header 传递：

```
Authorization: Bearer <your-token>
```

### Rate Limit

默认每个 IP 每小时 600 次请求。响应 Header 中会包含：

```
X-Rate-Limit-Limit: 120
X-Rate-Limit-Remaining: 116
X-Rate-Limit-Reset: 1409479200
```

### 获取指定节点信息

```
GET /nodes/:node_name
```

示例：`GET /nodes/python`

### 获取指定节点下的主题

```
GET /nodes/:node_name/topics?p=1
```

参数：
- `p` — 分页页码，默认 1

示例：`GET /nodes/python/topics?p=2`

### 获取指定主题

```
GET /topics/:topic_id
```

示例：`GET /topics/1`

### 获取指定主题下的回复

```
GET /topics/:topic_id/replies?p=1
```

参数：
- `p` — 分页页码，默认 1

---

## 项目中使用的端点

| 配置 source | 使用的 API | 需要 Token |
|------------|-----------|-----------|
| `hot` | V1 `/topics/hot.json` | ❌ |
| `latest` | V1 `/topics/latest.json` | ❌ |
| 具体节点如 `claude` | V2 `/nodes/claude/topics` | ✅ |

## 参考链接

- [V2EX API 2.0 Beta 官方文档](https://v2ex.com/help/api)
- [V2EX 节点列表](https://www.v2ex.com/planes)
