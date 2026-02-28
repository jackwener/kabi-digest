// ── Source-agnostic item ──

export interface NewsItem {
    id: string;
    source: "hackernews" | "v2ex";
    title: string;
    url: string;          // original / discussion URL
    content: string;      // plain text (stripped HTML)
    category: string;     // node name or story type
    author: string;
    replies: number;
    points: number;       // HN score; V2EX uses replies as proxy
    createdAt: Date;
}

export interface ScoredItem {
    item: NewsItem;
    score: number;
}

export interface SummarizedItem extends ScoredItem {
    description: string;
}

// ── Config ──

export interface AppConfig {
    ai: {
        provider: "openai" | "anthropic";
        apiKey: string;
        model: string;
        baseUrl: string;
    };
    hackernews: {
        enabled: boolean;
        lists: string[];
        limit: number;
        topN: number;
    };
    v2ex: {
        enabled: boolean;
        token: string;
        nodes: string[];
        excludeNodes: string[];
        topN: number;
        pages: number;
    };
    skipHours: number;
    extractor: {
        enabled: boolean;
        concurrency: number;
        maxLength: number;
        timeout: number;
    };
}

// ── HN API raw types ──

export interface HNRawItem {
    id: number;
    type: string;
    by: string;
    title: string;
    url: string;
    text: string;
    time: number;
    kids: number[];
    descendants: number;
    score: number;
}

// ── V2EX API raw types ──

export interface V2EXRawTopic {
    id: number;
    title: string;
    url: string;
    content: string;
    content_rendered: string;
    replies: number;
    node: { name: string; title: string };
    member: { username: string };
    created: number;
    last_modified: number;
}
