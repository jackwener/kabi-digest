import type { NewsItem, V2EXRawReply } from "../types";

const V2EX_V1 = "https://www.v2ex.com/api";
const V2EX_V2 = "https://www.v2ex.com/api/v2";
const JINA_PREFIX = "https://r.jina.ai/";
const REPLY_MAX_PAGES = 200;

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

const DEFAULTS: EnrichConfig = { concurrency: 3, maxLength: 20000, timeout: 15000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Enrich V2EX items with full discussion context in generate stage:
 * - replies (all pages)
 * - supplements (附言)
 * Falls back to Jina Reader only when topic content is empty.
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

            let content = (item.content || "").trim();

            // 1) Replies (prefer V2 with token, fallback to V1)
            const replies = item.replies > 0 ? await fetchReplies(item.id, token, timeout) : [];
            if (replies.length > 0) {
                const replyText = replies
                    .map((r, i) => {
                        const date = r.created > 0 ? new Date(r.created * 1000).toISOString() : "";
                        const header = `#${i + 1} by ${r.author}${date ? ` @ ${date}` : ""}`;
                        return `${header}\n${r.content}`;
                    })
                    .join("\n\n");
                content = appendSection(content, "Replies", replyText);
            }

            // 2) Supplements (附言)
            const supplements = token
                ? await fetchSupplements(item.id, token, timeout)
                : null;
            if (supplements && supplements.length > 0) {
                const supText = supplements
                    .map((s, i) => `#${i + 1}\n${stripHTML(s.content_rendered || s.content)}`)
                    .join("\n\n");
                content = appendSection(content, "Supplements", supText);
            }

            // 3) Fallback fetch if topic body is empty
            if (!content.trim()) {
                const jinaContent = await fetchViaJina(item.url, maxLength, timeout);
                if (jinaContent) content = jinaContent;
            }

            item.contentTruncated = content.length > maxLength;
            item.content = content.slice(0, maxLength);
            console.log(` ✓ ${replies.length} replies${supplements ? `, ${supplements.length} supplements` : ""}`);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
    );
}

function appendSection(content: string, title: string, body: string): string {
    const head = `--- ${title} ---`;
    if (!content.trim()) return `${head}\n${body}`;
    return `${content}\n\n${head}\n${body}`;
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

interface V2EXReply {
    id: number;
    author: string;
    content: string;
    created: number;
}

async function fetchReplies(topicId: string, token: string, timeout: number): Promise<V2EXReply[]> {
    if (token) {
        const v2 = await fetchRepliesV2(topicId, token, timeout);
        if (v2.length > 0) return v2;
    }
    return fetchRepliesV1(topicId, timeout);
}

async function fetchRepliesV1(topicId: string, timeout: number): Promise<V2EXReply[]> {
    try {
        const resp = await fetch(`${V2EX_V1}/replies/show.json?topic_id=${topicId}`, {
            headers: { "User-Agent": "kabi-reader/0.1" },
            signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) return [];
        const data = await resp.json() as any;
        const replies: V2EXRawReply[] = Array.isArray(data) ? data : data.result ?? [];
        return normalizeReplies(replies);
    } catch {
        return [];
    }
}

async function fetchRepliesV2(topicId: string, token: string, timeout: number): Promise<V2EXReply[]> {
    const headers = {
        Authorization: `Bearer ${token}`,
        "User-Agent": "kabi-reader/0.1",
    };

    const all: V2EXReply[] = [];
    const seenIds = new Set<number>();
    let lastPageSignature = "";

    for (let p = 1; p <= REPLY_MAX_PAGES; p++) {
        try {
            const resp = await fetch(`${V2EX_V2}/topics/${topicId}/replies?p=${p}`, {
                headers,
                signal: AbortSignal.timeout(timeout),
            });
            if (!resp.ok) break;
            const data = await resp.json() as any;
            const replies: V2EXRawReply[] = Array.isArray(data) ? data : data.result ?? [];
            if (replies.length === 0) break;

            const normalized = normalizeReplies(replies);
            if (normalized.length === 0) break;

            const signature = `${normalized.length}:${normalized[0]!.id}:${normalized[normalized.length - 1]!.id}`;
            if (signature === lastPageSignature) break;
            lastPageSignature = signature;

            let appended = 0;
            for (const r of normalized) {
                if (r.id > 0 && seenIds.has(r.id)) continue;
                if (r.id > 0) seenIds.add(r.id);
                all.push(r);
                appended++;
            }
            if (appended === 0) break;
            if (p < REPLY_MAX_PAGES) await sleep(120);
        } catch {
            break;
        }
    }

    return all;
}

function normalizeReplies(replies: V2EXRawReply[]): V2EXReply[] {
    return replies
        .map((r) => ({
            id: r.id ?? 0,
            author: r.member?.username ?? "",
            content: stripHTML(r.content_rendered || r.content || ""),
            created: r.created ?? 0,
        }))
        .filter((r) => r.content.trim().length > 0);
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
