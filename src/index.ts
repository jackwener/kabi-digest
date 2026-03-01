#!/usr/bin/env bun
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT_DIR } from "./config";
import { fetchHN } from "./sources/hackernews";
import { fetchV2EX } from "./sources/v2ex";
import { enrichV2EXItems } from "./sources/enricher";
import { scoreAndRank } from "./scorer";
import { Summarizer } from "./summarizer";
import { renderMarkdown } from "./renderer";
import { Storage } from "./storage";
import { extractBatch } from "./extractor";
import type { AppConfig, NewsItem, SummarizedItem } from "./types";

function getToday(): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
}

const program = new Command();

program
    .name("digest")
    .description("聚合阅读器 — V2EX + Hacker News 日报生成")
    .version("0.1.0");

program
    .command("collect")
    .description("采集数据（只 fetch + merge，不评分不总结）")
    .option("--hn-only", "仅 HN")
    .option("--v2ex-only", "仅 V2EX")
    .action(async (opts) => {
        try {
            await runCollect(opts);
        } catch (err) {
            console.error("❌", err);
            process.exit(1);
        }
    });

program
    .command("generate")
    .description("从累积池生成今日日报（评分 + 正文抓取 + 可选 AI 总结）")
    .option("--no-ai", "跳过 AI 总结")
    .option("-t, --top-n <number>", "覆盖每个源的 top-n", parseInt)
    .option("--hn-only", "仅 HN")
    .option("--v2ex-only", "仅 V2EX")
    .action(async (opts) => {
        try {
            await runGenerate(opts);
        } catch (err) {
            console.error("❌", err);
            process.exit(1);
        }
    });

program.parse();

// ── collect ──────────────────────────────────────────────

async function runCollect(opts: any) {
    const config = loadConfig();
    const today = getToday();

    console.log(`📥 collect — ${today}\n`);

    const { hnItems, v2exItems } = await fetchAll(config, opts);

    const hnStorage = new Storage(join(ROOT_DIR, "data", "hackernews"));
    const v2exStorage = new Storage(join(ROOT_DIR, "data", "v2ex"));

    if (hnItems.length > 0) {
        hnStorage.merge(today, hnItems);
        const pool = hnStorage.load(today);
        console.log(`\n💾 HN: ${hnItems.length} fetched → ${pool.length} total in pool`);
    }
    if (v2exItems.length > 0) {
        v2exStorage.merge(today, v2exItems);
        const pool = v2exStorage.load(today);
        console.log(`💾 V2EX: ${v2exItems.length} fetched → ${pool.length} total in pool`);
    }

    console.log("\n✅ Data collected. Run `generate` when ready to produce the digest.");
}

// ── helpers ───────────────────────────────────────────────

/**
 * Generate a plain-text snippet from article content.
 * Truncates at sentence/paragraph boundary within maxLen.
 */
function generateSnippet(content: string, maxLen = 300): string {
    if (!content || !content.trim()) return "";
    // Strip Jina Reader metadata, markdown images/links, and excessive whitespace
    const cleaned = content
        .replace(/^URL Source:.*\n?/gim, "")
        .replace(/^Published Time:.*\n?/gim, "")
        .replace(/^Markdown Content:\n?/gim, "")
        .replace(/^#+\s+.*/gm, "")
        .replace(/^[-=]{3,}\s*$/gm, "")
        .replace(/!\[.*?\]\(.*?\)/g, "")
        .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (cleaned.length <= maxLen) return cleaned;
    // Try to cut at sentence boundary
    const truncated = cleaned.slice(0, maxLen);
    const lastPeriod = Math.max(
        truncated.lastIndexOf("。"),
        truncated.lastIndexOf(". "),
        truncated.lastIndexOf("！"),
        truncated.lastIndexOf("？"),
    );
    if (lastPeriod > maxLen * 0.4) return truncated.slice(0, lastPeriod + 1);
    // Fallback: cut at last space
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > maxLen * 0.5) return truncated.slice(0, lastSpace) + "...";
    return truncated + "...";
}

// ── generate ──────────────────────────────────────────────

async function runGenerate(opts: any) {
    const config = loadConfig();
    const today = getToday();
    const useAi = opts.ai !== false && !!config.ai.apiKey;

    console.log(`📋 generate — ${today}`);
    console.log(`   AI: ${useAi ? `${config.ai.provider}/${config.ai.model}` : "disabled"}\n`);

    // ── Score & Rank (from accumulated pool) ──
    const hnStorage = new Storage(join(ROOT_DIR, "data", "hackernews"));
    const v2exStorage = new Storage(join(ROOT_DIR, "data", "v2ex"));

    const hnSkipIds = hnStorage.getRecentIds(config.skipHours, today);
    const v2exSkipIds = v2exStorage.getRecentIds(config.skipHours, today);

    const hnPool = !opts.v2exOnly ? hnStorage.loadAll(today, []) : [];
    const v2exPool = !opts.hnOnly ? v2exStorage.loadAll(today, []) : [];

    const hnRanked = scoreAndRank(hnPool, opts.topN ?? config.hackernews.topN, hnSkipIds);
    const v2exRanked = scoreAndRank(v2exPool, opts.topN ?? config.v2ex.topN, v2exSkipIds, config.v2ex.excludeNodes);

    console.log(`📊 HN: ${hnPool.length} pooled → ${hnRanked.length} ranked`);
    console.log(`📊 V2EX: ${v2exPool.length} pooled → ${v2exRanked.length} ranked\n`);

    // ── Enrich V2EX items with supplements (附言) ──
    if (v2exRanked.length > 0 && config.v2ex.token) {
        console.log(`📎 Enriching V2EX items with supplements...`);
        await enrichV2EXItems(
            v2exRanked.map((r) => r.item),
            config.v2ex.token,
            { concurrency: config.extractor.concurrency, timeout: config.extractor.timeout },
        );
    }

    // ── Summarize ──
    const summarizer = useAi
        ? new Summarizer({
            provider: config.ai.provider,
            apiKey: config.ai.apiKey,
            model: config.ai.model,
            baseUrl: config.ai.baseUrl || undefined,
        })
        : null;

    async function summarizeGroup(ranked: { item: NewsItem; score: number }[]): Promise<{ items: SummarizedItem[]; overall: string }> {
        const items: SummarizedItem[] = [];
        let overall = "";

        // Content extraction — always run (free, no API key needed)
        if (config.extractor.enabled && ranked.length > 0) {
            console.log("   📄 Extracting article content...");
            await extractBatch(
                ranked.map((r) => r.item),
                {
                    concurrency: config.extractor.concurrency,
                    maxLength: config.extractor.maxLength,
                    timeout: config.extractor.timeout,
                },
            );
        }

        if (summarizer && ranked.length > 0) {
            for (const { item, score } of ranked) {
                process.stdout.write(`   🤖 ${item.title.slice(0, 40)}...`);
                const desc = await summarizer.summarizeItem(item.title, item.content);
                items.push({ item, score, description: desc });
                console.log(" ✓");
            }
            overall = await summarizer.summarizeAll(ranked.map((r) => r.item));
        } else {
            // No AI: include full extracted content for downstream consumers (e.g. OpenClaw)
            for (const { item, score } of ranked) {
                items.push({ item, score, description: item.content || "" });
            }
        }
        return { items, overall };
    }

    // ── Render & Write ──
    const outDir = join(ROOT_DIR, "out");
    mkdirSync(outDir, { recursive: true });

    if (hnRanked.length > 0) {
        const { items, overall } = await summarizeGroup(hnRanked);
        const md = renderMarkdown({
            title: `Hacker News 日报 ${today}`,
            date: today,
            summary: overall,
            items,
        });
        const path = join(outDir, `hn-${today}.md`);
        writeFileSync(path, md, "utf-8");
        console.log(`✅ ${path}`);
    }

    if (v2exRanked.length > 0) {
        const { items, overall } = await summarizeGroup(v2exRanked);
        const md = renderMarkdown({
            title: `V2EX 日报 ${today}`,
            date: today,
            summary: overall,
            items,
        });
        const path = join(outDir, `v2ex-${today}.md`);
        writeFileSync(path, md, "utf-8");
        console.log(`✅ ${path}`);
    }

    if (hnRanked.length === 0 && v2exRanked.length === 0) {
        console.log("⚠️  没有产出任何日报（所有 item 被过滤或 fetch 失败）");
    }

    console.log("\n🎉 Done!");
}

// ── shared fetch logic ──────────────────────────────────

async function fetchAll(config: AppConfig, opts: any) {
    const hnItems: NewsItem[] = [];
    const v2exItems: NewsItem[] = [];

    if (config.hackernews.enabled && !opts.v2exOnly) {
        console.log(`🔶 Hacker News`);
        for (const list of config.hackernews.lists) {
            process.stdout.write(`   Fetching ${list}...`);
            try {
                const items = await fetchHN(list, config.hackernews.limit);
                hnItems.push(...items);
                console.log(` ${items.length} stories`);
            } catch (err) {
                console.log(` ⚠️ failed:`, err instanceof Error ? err.message : err);
            }
        }
    }

    if (config.v2ex.enabled && !opts.hnOnly) {
        const pages = config.v2ex.pages;
        console.log(`🟢 V2EX (pages: ${pages})`);
        for (const node of config.v2ex.nodes) {
            process.stdout.write(`   Fetching ${node}...`);
            try {
                const items = await fetchV2EX(node, config.v2ex.token, pages);
                v2exItems.push(...items);
                console.log(` ${items.length} topics`);
            } catch (err) {
                console.log(` ⚠️ failed:`, err instanceof Error ? err.message : err);
            }
        }
    }

    return { hnItems, v2exItems };
}
