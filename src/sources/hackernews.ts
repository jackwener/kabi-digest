import type { HNRawItem, NewsItem } from "../types";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const MAX_CONCURRENT = 8;

const LIST_MAP: Record<string, string> = {
    top: "topstories", new: "newstories", best: "beststories",
    ask: "askstories", show: "showstories", job: "jobstories",
};

export async function fetchHN(list: string, limit: number): Promise<NewsItem[]> {
    const endpoint = LIST_MAP[list.toLowerCase()] ?? LIST_MAP.top;
    const ids: number[] = await fetch(`${HN_API}/${endpoint}.json`).then((r) => r.json() as any);

    return fetchConcurrent(ids.slice(0, limit));
}

async function fetchConcurrent(ids: number[]): Promise<NewsItem[]> {
    const results: (NewsItem | null)[] = new Array(ids.length).fill(null);
    let cursor = 0;

    async function worker() {
        while (true) {
            const idx = cursor++;
            if (idx >= ids.length) break;
            try {
                const resp = await fetch(`${HN_API}/item/${ids[idx]}.json`, {
                    signal: AbortSignal.timeout(8000),
                });
                if (!resp.ok) continue;
                const raw = (await resp.json()) as HNRawItem;
                if (raw) results[idx] = normalize(raw);
            } catch { /* skip timeouts */ }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT, ids.length) }, () => worker()),
    );
    return results.filter((r): r is NewsItem => r !== null);
}

function normalize(h: HNRawItem): NewsItem {
    const id = String(h.id);
    const hnUrl = `https://news.ycombinator.com/item?id=${id}`;
    const url = (h.url ?? "").trim() || hnUrl;

    let category = (h.type ?? "story").toLowerCase();
    if (category === "story") {
        const t = (h.title ?? "").toLowerCase().trim();
        if (t.startsWith("ask hn:")) category = "ask";
        else if (t.startsWith("show hn:")) category = "show";
    }

    return {
        id,
        source: "hackernews",
        title: h.title ?? "",
        url,
        content: stripHTML(h.text ?? ""),
        category,
        author: h.by ?? "",
        replies: Math.max(h.descendants ?? 0, (h.kids ?? []).length),
        points: h.score ?? 0,
        createdAt: new Date((h.time ?? 0) * 1000),
    };
}

function stripHTML(s: string): string {
    return s.replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .trim();
}
