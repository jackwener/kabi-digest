import type { V2EXRawTopic, NewsItem } from "../types";

// V2EX v1 API (no token needed) and v2 API (token needed)
const V2EX_V1 = "https://www.v2ex.com/api";
const V2EX_V2 = "https://www.v2ex.com/api/v2";

export async function fetchV2EX(source: string, token: string): Promise<NewsItem[]> {
    // Use v1 API for common endpoints (no auth needed), v2 for node browsing
    const headers: Record<string, string> = { "User-Agent": "kabi-reader/0.1" };

    let url: string;
    if (source === "hot") {
        url = `${V2EX_V1}/topics/hot.json`;
    } else if (source === "latest") {
        url = `${V2EX_V1}/topics/latest.json`;
    } else if (token) {
        // Node-specific requires v2 API + token
        url = `${V2EX_V2}/nodes/${source}/topics`;
        headers["Authorization"] = `Bearer ${token}`;
    } else {
        // Fallback: use v1 hot if no token
        console.warn(`   ⚠️ Node "${source}" requires V2EX token, falling back to hot`);
        url = `${V2EX_V1}/topics/hot.json`;
    }

    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
        throw new Error(`V2EX API error: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as any;
    const topics: V2EXRawTopic[] = Array.isArray(data) ? data : data.result ?? [];
    return topics.map(normalize);
}

function normalize(t: V2EXRawTopic): NewsItem {
    return {
        id: String(t.id),
        source: "v2ex",
        title: t.title,
        url: t.url || `https://www.v2ex.com/t/${t.id}`,
        content: stripHTML(t.content_rendered || t.content || ""),
        category: t.node?.name ?? "",
        author: t.member?.username ?? "",
        replies: t.replies ?? 0,
        points: t.replies ?? 0,
        createdAt: new Date((t.created ?? 0) * 1000),
    };
}

function stripHTML(s: string): string {
    return s.replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .trim();
}
