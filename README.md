# Digest

> V2EX + Hacker News 聚合日报生成器

自动抓取热门内容，时间衰减评分排序，支持两种运行模式：
- `ai_digest`：强制 AI 总结，输出给人读的日报
- `openclaw`：无 AI，直接输出 top_n JSON 给 OpenClaw

## 快速开始

```bash
bun install
cp config.example.yaml config.yaml
bun run collect
bun run generate:ai
```

## OpenClaw 自动化

如果你是 [OpenClaw](https://openclaw.com)，请阅读 [openclaw.md](openclaw.md) 并按照其中的说明配置 Cron 定时任务。

## 命令

```bash
# 采集模式（只 fetch + 累积数据，不调 AI）
bun run collect               # 采集 V2EX + HN 数据
bun run collect --hn-only     # 仅采集 HN
bun run collect --v2ex-only   # 仅采集 V2EX

# 生成模式（明确区分两类用途）
bun run generate:ai                 # AI 日报模式（必须有 AI key）
bun run generate:openclaw           # OpenClaw 模式（不使用 AI）

# 通用入口（显式指定 profile）
bun run src/index.ts generate --profile ai_digest
bun run src/index.ts generate --profile openclaw
```

**推荐用法**：白天定时 `collect` 累积数据，晚上按目标运行 `generate:ai` 或 `generate:openclaw`。

## 配置

只需一个 `config.yaml`，所有选项都有默认值。  
如果运行 `ai_digest`，必须配置 `ai.api_key`（或环境变量）；`openclaw` 可不配。

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

`ai_digest` 模式下不配置 `api_key` 会直接报错并退出。  
`openclaw` 模式下不会调用 AI。

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
- 采集阶段只抓 topic 基础信息；`generate` 阶段才补齐 replies / 正文内容
- **Token 获取**: [V2EX 设置页](https://www.v2ex.com/settings/tokens) 创建 Personal Access Token
- **Rate Limit**: 每 IP 每小时 **600 次** 请求
- **默认节点**: `hot`

详细 API 文档见 [docs/](docs/)。

## 正文抓取

两种模式都会在 `generate` 阶段对 top-n 补齐内容：
- **HN**：通过 [Jina AI Reader](https://r.jina.ai/) 抓取外链全文
- **V2EX**：补齐 replies（全楼层）+ supplements（附言）

`ai_digest` 在此基础上做 AI 总结并输出 Markdown。  
`openclaw` 在此基础上输出结构化 JSON（含完整 `content`）。

内容补齐特性：
- 零配置、免费、无需 API key
- 自动跳过 HN 讨论页和 V2EX 帖子（无需抓取外链）
- 并发控制（默认 3），超时 graceful fallback
- `extractor.enabled` 必须为 `true`

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
- **发布去重**: 通过 `skip_hours`（默认 72h）+ `data/published/index.json` 实现——只要某条 item 在过去 N 小时内已经被发布过（按 source+id），下一次 `generate` 会跳过。

## 输出

```
out/
├── human_digest/
│   ├── hn-2026-02-28.md                # 人读短摘要版
│   └── v2ex-2026-02-28.md
├── llm_context/
│   ├── hn-2026-02-28.md                # LLM 长上下文版
│   └── v2ex-2026-02-28.md
└── openclaw/
    ├── hn-2026-02-28.json              # OpenClaw 输入（top_n JSON）
    └── v2ex-2026-02-28.json
data/
├── hackernews/           # HN 原始采集池
├── v2ex/                 # V2EX 原始采集池
└── published/
    └── index.json        # 已发布记录（去重依据）
```

输出策略按运行模式区分：
- `ai_digest`：写入 `human_digest`（主输出）+ `llm_context`（上下文）
- `openclaw`：仅写入 `openclaw/*.json`（包含 rank、score、`content` 和 `contentTruncated`，可直接喂给 OpenClaw）；即使没有条目也会输出空数组 JSON

`ai_digest` 产出的 Markdown 日报包含 YAML frontmatter（`title`, `date`, `profile`, `summary`），方便与 Hugo / Astro 等静态站点集成。

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
