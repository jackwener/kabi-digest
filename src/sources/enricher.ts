import type { NewsItem } from "../types";

const V2EX_V2 = "https://www.v2ex.com/api/v2";
const JINA_PREFIX = "https://r.jina.ai/";

interface Supplement {
    id: number;
    content: string;
    content_rendered: string;
    syntax: number;
    created: number;
}

interface EnrichConfig {
    concurrency: number;
    maxLength: number;
    timeout: number;
}

const DEFAULTS: EnrichConfig = { concurrency: 3, maxLength: 8000, timeout: 15000 };

/**
 * Enrich V2EX items with supplements (附言) from V2 API.
 * Falls back to Jina Reader if API fails.
 * Modifies `item.content` in-place.
 */
export async function enrichV2EXItems(
    items: NewsItem[],
    token: string,
    config?: Partial<EnrichConfig>,
): Promise<void> {
    if (items.length === 0) return;

    const { concurrency, maxLength, timeout } = { ...DEFAULTS, ...config };
    let cursor = 0;

    async function worker() {
        while (true) {
            const idx = cursor++;
            if (idx >= items.length) break;
            const item = items[idx]!;
            process.stdout.write(`   📎 ${item.title.slice(0, 50)}...`);

            // Primary: V2 API
            const supplements = token
                ? await fetchSupplements(item.id, token, timeout)
                : null;

            if (supplements && supplements.length > 0) {
                const supText = supplements
                    .map((s, i) => `\n\n--- 附言 ${i + 1} ---\n${stripHTML(s.content_rendered || s.content)}`)
                    .join("");
                item.content = (item.content + supText).slice(0, maxLength);
                console.log(` ✓ ${supplements.length} 条附言 (API)`);
                continue;
            }

            // Fallback: Jina Reader
            const jinaContent = await fetchViaJina(item.url, maxLength, timeout);
            if (jinaContent) {
                item.content = jinaContent;
                console.log(` ✓ (Jina fallback)`);
            } else {
                console.log(` ⏭ (no supplements)`);
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
    );
}

async function fetchSupplements(
    topicId: string,
    token: string,
    timeout: number,
): Promise<Supplement[] | null> {
    try {
        const resp = await fetch(`${V2EX_V2}/topics/${topicId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent": "kabi-reader/0.1",
            },
            signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) return null;
        const data = await resp.json() as any;
        const result = data.result ?? data;
        return (result.supplements as Supplement[]) ?? [];
    } catch {
        return null;
    }
}

async function fetchViaJina(
    url: string,
    maxLength: number,
    timeout: number,
): Promise<string> {
    try {
        const resp = await fetch(`${JINA_PREFIX}${url}`, {
            headers: { Accept: "text/markdown" },
            signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) return "";
        const text = await resp.text();
        const cleaned = text
            .replace(/^Title:.*\n/i, "")
            .replace(/^URL Source:.*\n/i, "")
            .replace(/^Markdown Content:\n/i, "")
            .trim();
        return cleaned.slice(0, maxLength);
    } catch {
        return "";
    }
}

function stripHTML(s: string): string {
    return s.replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .trim();
}
