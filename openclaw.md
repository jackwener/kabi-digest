# OpenClaw 自动化任务

本项目通过 OpenClaw 定时执行数据采集和日报生成。

## 定时任务

### 1. 数据采集（每 2 小时）

每天 8:00 ~ 22:00，每隔 2 小时运行一次，只采集数据不生成日报：

```bash
cd ~/code/digest && bun run collect
```

> 该命令仅 fetch + merge 数据到 `data/` 目录，不调用 AI，不产生 token 消耗。

### 2. 生成并发送日报（每天 23:00）

先生成日报，然后阅读并总结发送给我：

**步骤一：生成日报**

```bash
cd ~/code/digest && bun run generate:openclaw
```

> 该命令从累积池评分排序，并在 generate 阶段补齐完整语料后输出 JSON 给 OpenClaw。
> 主要输出：
> - `out/openclaw/hn-YYYY-MM-DD.json`
> - `out/openclaw/v2ex-YYYY-MM-DD.json`
> - `hn` 的 `content` 为外链正文（可抓取时）
> - `v2ex` 的 `content` 包含 topic 正文 + replies + supplements
> - 每条记录含 `contentTruncated` 字段，标识是否被长度截断
> - 即使当天没有可发布条目，也会输出空 `items` JSON 文件
> 该模式不调用 AI API，不会写 `human_digest` / `llm_context`。

**步骤二：阅读并总结**

读取今天生成的 `openclaw` JSON 文件（主输入）：

```bash
cat out/openclaw/hn-$(date +%Y-%m-%d).json
cat out/openclaw/v2ex-$(date +%Y-%m-%d).json
```

阅读文件内容后，请你用中文将所有条目**总结成一份完整的 Markdown 文档**发送给我。要求：

- 按 HN 和 V2EX 分两个大类
- 每个条目都进行总结，保留原文链接
- 标注关键数据（分数、回复数等）
- 对整体内容写一段简短的今日概况

## 时间线总览

| 时间 | 任务 |
|------|------|
| 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00 | 数据采集：`bun run collect` |
| 23:00 | 生成日报 + 阅读总结并发送给我 |
