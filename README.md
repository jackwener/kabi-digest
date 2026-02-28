# Digest

> V2EX + Hacker News 聚合日报生成器

自动抓取热门内容，评分排序，可选 AI 总结，输出 Markdown 日报。

## 快速开始

```bash
# 安装依赖
bun install

# 复制配置并填写（可选填 AI key）
cp config.example.yaml config.yaml

# 生成日报
bun run generate

# 跳过 AI 总结
bun run generate --no-ai

# 仅 HN / 仅 V2EX
bun run generate --hn-only
bun run generate --v2ex-only

# 自定义数量
bun run generate --top-n 5
```

输出到 `out/hn-YYYY-MM-DD.md` 和 `out/v2ex-YYYY-MM-DD.md`。

## 配置

只需一个 `config.yaml`，所有选项都有默认值：

```yaml
ai:
  api_key: ""          # 不填则跳过 AI 总结
  model: "gpt-4o-mini"
  base_url: ""         # 兼容 API 地址

hackernews:
  top_n: 20            # 输出文章数

v2ex:
  token: ""            # 可选，提高请求频率
  top_n: 20
```

详见 [config.example.yaml](config.example.yaml)。

## 项目结构

```
src/
├── index.ts           # CLI 入口
├── config.ts          # 配置加载
├── types.ts           # 类型定义
├── scorer.ts          # 时间衰减评分
├── summarizer.ts      # AI 总结（OpenAI / Anthropic）
├── renderer.ts        # Markdown 渲染
├── storage.ts         # 数据去重存储
└── sources/
    ├── hackernews.ts  # HN API 客户端
    └── v2ex.ts        # V2EX API 客户端
```

## License

MIT
