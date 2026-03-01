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
import { PublishedIndex, Storage } from "./storage";
import { extractBatch } from "./extractor";
import type { AppConfig, NewsItem, OutputItem, ScoredItem } from "./types";

function getToday(): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
}

type GenerateMode = "ai_digest" | "openclaw";

function parseGenerateMode(raw: string): GenerateMode {
    if (raw === "ai_digest" || raw === "openclaw") return raw;
    throw new Error(`Invalid profile "${raw}". Use "ai_digest" or "openclaw".`);
}

function withGenerateOptions(cmd: Command): Command {
    return cmd
        .option("-t, --top-n <number>", "覆盖每个源的 top-n", parseInt)
        .option("--hn-only", "仅 HN")
        .option("--v2ex-only", "仅 V2EX");
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

withGenerateOptions(
    program
        .command("generate")
        .description("从累积池生成日报（需指定 profile: ai_digest | openclaw）")
        .requiredOption("--profile <profile>", "ai_digest | openclaw"),
).action(async (opts) => {
    try {
        await runGenerate(opts, parseGenerateMode(opts.profile));
    } catch (err) {
        console.error("❌", err);
        process.exit(1);
    }
});

withGenerateOptions(
    program
        .command("generate-ai")
        .description("AI 日报模式（强制要求 AI key）"),
).action(async (opts) => {
    try {
        await runGenerate(opts, "ai_digest");
    } catch (err) {
        console.error("❌", err);
        process.exit(1);
    }
});

withGenerateOptions(
    program
        .command("generate-openclaw")
        .description("OpenClaw 模式（不使用 AI，输出 top_n JSON）"),
).action(async (opts) => {
    try {
        await runGenerate(opts, "openclaw");
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

    const truncated = cleaned.slice(0, maxLen);
    const lastPeriod = Math.max(
        truncated.lastIndexOf("。"),
        truncated.lastIndexOf(". "),
        truncated.lastIndexOf("！"),
        truncated.lastIndexOf("？"),
    );
    if (lastPeriod > maxLen * 0.4) return truncated.slice(0, lastPeriod + 1);

    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > maxLen * 0.5) return truncated.slice(0, lastSpace) + "...";
    return truncated + "...";
}

// ── generate ──────────────────────────────────────────────

async function runGenerate(opts: any, mode: GenerateMode) {
    const config = loadConfig();
    const today = getToday();

    if (mode === "ai_digest" && !config.ai.apiKey) {
        throw new Error("AI mode requires ai.api_key (or OPENAI_API_KEY / ANTHROPIC_API_KEY).");
    }
    if (!config.extractor.enabled) {
        throw new Error("extractor.enabled must be true in generate mode.");
    }

    const useAi = mode === "ai_digest";

    console.log(`📋 generate — ${today}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   AI: ${useAi ? `${config.ai.provider}/${config.ai.model}` : "disabled"}\n`);

    const hnStorage = new Storage(join(ROOT_DIR, "data", "hackernews"));
    const v2exStorage = new Storage(join(ROOT_DIR, "data", "v2ex"));
    const publishedIndex = new PublishedIndex(join(ROOT_DIR, "data", "published", "index.json"));

    const hnSkipIds = publishedIndex.getRecentIds(config.skipHours, "hackernews", today);
    const v2exSkipIds = publishedIndex.getRecentIds(config.skipHours, "v2ex", today);

    const enableHn = !opts.v2exOnly;
    const enableV2ex = !opts.hnOnly;

    const hnPool = enableHn ? hnStorage.loadAll(today, []) : [];
    const v2exPool = enableV2ex ? v2exStorage.loadAll(today, []) : [];

    const hnRanked = scoreAndRank(hnPool, opts.topN ?? config.hackernews.topN, hnSkipIds);
    const v2exRanked = scoreAndRank(v2exPool, opts.topN ?? config.v2ex.topN, v2exSkipIds, config.v2ex.excludeNodes);

    console.log(`📊 HN: ${hnPool.length} pooled → ${hnRanked.length} ranked`);
    console.log(`📊 V2EX: ${v2exPool.length} pooled → ${v2exRanked.length} ranked\n`);

    const outDir = join(ROOT_DIR, "out");
    mkdirSync(outDir, { recursive: true });

    if (mode === "openclaw") {
        if (v2exRanked.length > 0) {
            console.log("📎 Enriching V2EX items with replies/supplements...");
            await enrichV2EXItems(
                v2exRanked.map((r) => r.item),
                config.v2ex.token,
                {
                    concurrency: config.extractor.concurrency,
                    maxLength: Number.MAX_SAFE_INTEGER,
                    timeout: config.extractor.timeout,
                },
            );
        }

        const allRankedItems = [...hnRanked, ...v2exRanked].map((r) => r.item);
        if (allRankedItems.length > 0) {
            console.log("   📄 Extracting article content...");
            await extractBatch(
                allRankedItems,
                {
                    concurrency: config.extractor.concurrency,
                    maxLength: Number.MAX_SAFE_INTEGER,
                    timeout: config.extractor.timeout,
                },
            );
        }

        const openclawDir = join(outDir, "openclaw");
        mkdirSync(openclawDir, { recursive: true });

        function writeOpenClawJson(sourceName: "hn" | "v2ex", ranked: ScoredItem[]) {
            const payload = {
                profile: "openclaw",
                source: sourceName,
                date: today,
                topN: ranked.length,
                generatedAt: new Date().toISOString(),
                items: ranked.map((r, idx) => ({
                    rank: idx + 1,
                    score: Number(r.score.toFixed(6)),
                    ...r.item,
                    contentTruncated: Boolean(r.item.contentTruncated),
                })),
            };
            const path = join(openclawDir, `${sourceName}-${today}.json`);
            writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
            console.log(`✅ ${path}`);
        }

        if (enableHn) {
            writeOpenClawJson("hn", hnRanked);
            publishedIndex.markPublished(today, "hackernews", hnRanked.map((r) => r.item.id));
        }
        if (enableV2ex) {
            writeOpenClawJson("v2ex", v2exRanked);
            publishedIndex.markPublished(today, "v2ex", v2exRanked.map((r) => r.item.id));
        }

        if (hnRanked.length === 0 && v2exRanked.length === 0) {
            console.log("ℹ️  当前没有可发布条目，已输出空 openclaw JSON 文件");
        }
        console.log("\n🎉 Done!");
        return;
    }

    if (v2exRanked.length > 0) {
        console.log("📎 Enriching V2EX items with replies/supplements...");
        await enrichV2EXItems(
            v2exRanked.map((r) => r.item),
            config.v2ex.token,
            { concurrency: config.extractor.concurrency, timeout: config.extractor.timeout },
        );
    }

    const summarizer = useAi
        ? new Summarizer({
            provider: config.ai.provider,
            apiKey: config.ai.apiKey,
            model: config.ai.model,
            baseUrl: config.ai.baseUrl || undefined,
        })
        : null;

    async function summarizeGroup(ranked: ScoredItem[]): Promise<{ items: OutputItem[]; overall: string }> {
        let overall = "";

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

        const items: OutputItem[] = ranked.map(({ item, score }) => {
            const context = (item.content || "").trim();
            const digest = generateSnippet(context || item.title);
            return { item, score, digest, context };
        });

        if (summarizer && ranked.length > 0) {
            for (const outputItem of items) {
                const { item } = outputItem;
                process.stdout.write(`   🤖 ${item.title.slice(0, 40)}...`);
                const aiDigest = await summarizer.summarizeItem(item.title, outputItem.context || item.title);
                if (aiDigest.trim()) {
                    outputItem.digest = aiDigest.trim();
                    console.log(" ✓");
                } else {
                    console.log(" ⏭ (fallback snippet)");
                }
            }
            overall = await summarizer.summarizeAll(
                items.map(({ item, context }) => ({ ...item, content: context || item.content })),
            );
        }

        return { items, overall };
    }

    const humanOutDir = join(outDir, "human_digest");
    const llmOutDir = join(outDir, "llm_context");
    mkdirSync(humanOutDir, { recursive: true });
    mkdirSync(llmOutDir, { recursive: true });

    async function writeSourceOutputs(sourceName: "hn" | "v2ex", title: string, ranked: ScoredItem[]) {
        if (ranked.length === 0) return;
        const { items, overall } = await summarizeGroup(ranked);

        const llmMd = renderMarkdown({
            title,
            date: today,
            summary: overall,
            items,
            profile: "llm_context",
        });
        const llmPath = join(llmOutDir, `${sourceName}-${today}.md`);
        writeFileSync(llmPath, llmMd, "utf-8");
        console.log(`✅ ${llmPath}`);

        const humanMd = renderMarkdown({
            title,
            date: today,
            summary: overall,
            items,
            profile: "human_digest",
        });
        const humanPath = join(humanOutDir, `${sourceName}-${today}.md`);

        writeFileSync(humanPath, humanMd, "utf-8");
        console.log(`✅ ${humanPath}`);
        publishedIndex.markPublished(
            today,
            sourceName === "hn" ? "hackernews" : "v2ex",
            ranked.map((r) => r.item.id),
        );
    }

    await writeSourceOutputs("hn", `Hacker News 日报 ${today}`, hnRanked);
    await writeSourceOutputs("v2ex", `V2EX 日报 ${today}`, v2exRanked);

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
        console.log("🔶 Hacker News");
        for (const list of config.hackernews.lists) {
            process.stdout.write(`   Fetching ${list}...`);
            try {
                const items = await fetchHN(list, config.hackernews.limit);
                hnItems.push(...items);
                console.log(` ${items.length} stories`);
            } catch (err) {
                console.log(" ⚠️ failed:", err instanceof Error ? err.message : err);
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
                console.log(" ⚠️ failed:", err instanceof Error ? err.message : err);
            }
        }
    }

    return { hnItems, v2exItems };
}
