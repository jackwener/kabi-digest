import type { NewsItem, ScoredItem } from "./types";

/**
 * Time-decay scoring.
 *
 * HN:   score = (points - 1) / (hours + 2) ^ 1.8
 * V2EX: score = (replies - 1) / (hours + 2) ^ 1.8
 */
export function computeScore(item: NewsItem): number {
    const engagement = item.source === "hackernews" ? item.points : item.replies;
    if (engagement <= 0) return 0;

    const hours = Math.max((Date.now() - item.createdAt.getTime()) / 3_600_000, 0);
    const score = (engagement - 1) / Math.pow(hours + 2, 1.8);
    return isNaN(score) || score < 0 ? 0 : score;
}

/**
 * Score, deduplicate, filter, sort → top N.
 */
export function scoreAndRank(
    items: NewsItem[],
    topN: number,
    skipIds: Set<string> = new Set(),
    excludeCategories: string[] = [],
): ScoredItem[] {
    const excludeSet = new Set(excludeCategories.map((n) => n.toLowerCase()));
    const seen = new Set<string>();
    const unique: NewsItem[] = [];

    for (const item of items) {
        if (seen.has(item.id) || skipIds.has(item.id)) continue;
        if (excludeSet.has(item.category.toLowerCase())) continue;
        seen.add(item.id);
        unique.push(item);
    }

    return unique
        .map((item) => ({ item, score: computeScore(item) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);
}
