import type { NewsItem } from "./types";

const JINA_PREFIX = "https://r.jina.ai/";

interface ExtractorConfig {
    concurrency: number;
    maxLength: number;
    timeout: number;
}

const DEFAULTS: ExtractorConfig = { concurrency: 3, maxLength: 5000, timeout: 15000 };

/**
 * Check if URL points to a discussion page (no external article to fetch).
 */
function isDiscussionUrl(item: NewsItem): boolean {
    try {
        const host = new URL(item.url).hostname.toLowerCase();
        return (
            host.includes("news.ycombinator.com") ||
            host.includes("v2ex.com")
        );
    } catch {
        return true; // malformed URL, skip
    }
}

/**
 * Fetch article content via Jina AI Reader.
 * Returns markdown text or empty string on failure.
 */
async function extractContent(
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
        // Strip markdown title (Jina often prepends it)
        const cleaned = text.replace(/^Title:.*\n/i, "").replace(/^URL Source:.*\n/i, "").replace(/^Markdown Content:\n/i, "").trim();
        return cleaned.slice(0, maxLength);
    } catch {
        return "";
    }
}

/**
 * Batch-extract content for ranked items.
 * Modifies `item.content` in-place with fetched article body.
 * Skips discussion-only URLs (HN self-posts, V2EX topics).
 */
export async function extractBatch(
    items: NewsItem[],
    config?: Partial<ExtractorConfig>,
): Promise<void> {
    const { concurrency, maxLength, timeout } = { ...DEFAULTS, ...config };

    const toFetch = items.filter((item) => !isDiscussionUrl(item) && !item.content);
    if (toFetch.length === 0) return;

    let cursor = 0;

    async function worker() {
        while (true) {
            const idx = cursor++;
            if (idx >= toFetch.length) break;
            const item = toFetch[idx]!;
            process.stdout.write(`   📄 ${item.title.slice(0, 50)}...`);
            const content = await extractContent(item.url, maxLength, timeout);
            if (content) {
                item.content = content;
                console.log(` ✓ (${content.length} chars)`);
            } else {
                console.log(` ⏭ (fallback to existing)`);
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, toFetch.length) }, () => worker()),
    );
}
