# OpenClaw 自动化任务

本项目通过 OpenClaw 定时执行数据采集和日报生成。

## 定时任务

### 1. 数据采集（每 2 小时）

每天 8:00 ~ 22:00，每隔 2 小时运行一次，只采集数据不生成日报：

```bash
cd ~/code/digest && bun run collect
```

> 该命令仅 fetch + merge 数据到 `data/` 目录，不调用 AI，不产生 token 消耗。

### 2. 生成日报（每天 23:00）

从当天累积的完整数据池生成最终日报：

```bash
cd ~/code/digest && bun run generate --no-fetch
```

> `--no-fetch` 表示不再抓取新数据，仅从已有累积池评分 + AI 总结 + 输出 Markdown 日报。
> 输出文件：`out/hn-YYYY-MM-DD.md` 和 `out/v2ex-YYYY-MM-DD.md`。

### 3. 发送日报（每天 09:00）

将**昨天**的日报发送给我。日报文件路径规则：

```
out/hn-YYYY-MM-DD.md
out/v2ex-YYYY-MM-DD.md
```

昨天的日期可通过以下命令获取：

```bash
date -v-1d +%Y-%m-%d   # macOS
```

发送昨天的日报文件：

```bash
cat out/hn-$(date -v-1d +%Y-%m-%d).md
cat out/v2ex-$(date -v-1d +%Y-%m-%d).md
```

## 时间线总览

| 时间 | 任务 | 命令 |
|------|------|------|
| 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00 | 数据采集 | `bun run collect` |
| 23:00 | 生成日报 | `bun run generate --no-fetch` |
| 09:00（次日） | 发送昨日日报 | 读取 `out/*-昨日日期.md` 发送 |
