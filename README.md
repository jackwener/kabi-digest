# Digest

> V2EX + Hacker News 聚合日报生成器

自动抓取热门内容，时间衰减评分排序，可选 AI 总结，输出 Markdown 日报。

## 快速开始

```bash
bun install
cp config.example.yaml config.yaml   # 编辑填写 AI key（可选）
bun run generate --no-ai             # 先跑一次看看效果
```

## 命令

```bash
bun run generate              # 同时生成 V2EX + HN 日报
bun run generate --no-ai      # 跳过 AI 总结
bun run generate --hn-only    # 仅 HN
bun run generate --v2ex-only  # 仅 V2EX
bun run generate --top-n 5    # 覆盖 top-n 数量
```

## 配置

只需一个 `config.yaml`，所有选项都有默认值。最简只需填 `ai.api_key`。

详见 [config.example.yaml](config.example.yaml)。

### 环境变量

配置文件中留空的字段会自动 fallback 到环境变量：

| 环境变量 | 对应配置 |
|---------|---------|
| `OPENAI_API_KEY` | `ai.api_key` |
| `ANTHROPIC_API_KEY` | `ai.api_key` |
| `V2EX_TOKEN` | `v2ex.token` |

### AI 配置

支持 OpenAI 和 Anthropic 两种 provider，也支持任何 OpenAI 兼容的 API（通过 `base_url`）：

```yaml
ai:
  api_key: "sk-xxx"
  model: "gpt-4o-mini"
  base_url: "https://your-proxy.com/v1"  # 可选
  provider: "openai"                      # openai | anthropic
```

不配置 `api_key` 则自动跳过 AI 总结，仅输出标题和元数据。

## 数据源

### Hacker News

- **API**: [Firebase API](https://github.com/HackerNews/API)（无需认证）
- **抓取方式**: 先获取 story ID 列表，再 8 并发获取详情（每个 8s 超时）
- **默认列表**: `top`（可选 `new`, `best`, `ask`, `show`）
- **默认每列表抓取**: 30 条
- **Rate Limit**: 无官方限制，但建议控制频率

### V2EX

- **API**: V1（免 token）+ V2（需 token）
- `hot` / `latest` → V1 API，**无需 Token**
- 具体节点（如 `claude`, `python`）→ V2 API，**需要 Token**，支持**多页抓取**（默认 3 页）
- **Token 获取**: [V2EX 设置页](https://www.v2ex.com/settings/tokens) 创建 Personal Access Token
- **Rate Limit**: 每 IP 每小时 **600 次** 请求
- **默认节点**: `hot`

详细 API 文档见 [docs/](docs/)。

## 正文抓取

对筛选后的 top-n 文章，自动通过 [Jina AI Reader](https://r.jina.ai/) 抓取原文正文（Markdown 格式），让 AI 基于**完整文章内容**生成高质量摘要，而非仅依赖标题。

- 零配置、免费、无需 API key
- 自动跳过 HN 讨论页和 V2EX 帖子（无需抓取外链）
- 并发控制（默认 3），超时 graceful fallback
- 可通过 `extractor.enabled: false` 关闭

## 评分算法

使用 **时间衰减评分**（类似 HN 排名算法）：

```
score = (engagement - 1) / (hours + 2) ^ 1.8
```

- HN: `engagement` = points（投票数）
- V2EX: `engagement` = replies（回复数）
- `hours` = 距发布时间的小时数

新且热门的内容得分更高，老内容自然衰减。

## 去重与累积

- **数据累积**: 每次运行 `generate` 会将新抓取的数据与当天已有数据**按 ID 合并**（upsert），而非覆盖。多次运行会持续扩大候选池，item 的 replies/points 等数据自动更新为最新值。
- **跨天去重**: 通过 `skip_hours`（默认 72h）实现——已在过去 N 小时内**其他天**输出过的 item ID 会被跳过，避免连续多天生成相同内容。

## 输出

```
out/
├── hn-2026-02-28.md      # HN 日报
└── v2ex-2026-02-28.md    # V2EX 日报
data/
├── hackernews/           # HN 原始数据（用于去重）
└── v2ex/                 # V2EX 原始数据
```

每篇日报包含 YAML frontmatter（`title`, `date`, `summary`），方便与 Hugo / Astro 等静态站点集成。

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── config.ts             # 配置加载（YAML + env fallback）
├── types.ts              # 类型定义
├── scorer.ts             # 时间衰减评分
├── extractor.ts          # 正文抓取（Jina AI Reader）
├── summarizer.ts         # AI 总结（OpenAI / Anthropic）
├── renderer.ts           # Markdown 渲染（HN 中文 / V2EX 中文）
├── storage.ts            # JSON 存储（累积合并 + 去重）
└── sources/
    ├── hackernews.ts     # HN API 客户端（并发 fetch）
    └── v2ex.ts           # V2EX API 客户端（v1 + v2）
```

## License

MIT
