import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NewsItem } from "./types";

interface DailyData {
    date: string;
    fetchedAt: string;
    items: NewsItem[];
}

export class Storage {
    constructor(private dataDir: string) {
        mkdirSync(dataDir, { recursive: true });
    }

    /**
     * Merge new items into the daily JSON file (upsert by id).
     * Existing items with the same id are updated with fresh data (e.g. new replies count).
     */
    merge(date: string, newItems: NewsItem[]): void {
        const existing = this.load(date);
        const map = new Map<string, NewsItem>();

        // Seed with existing items
        for (const item of existing) map.set(item.id, item);
        // Upsert with new items (newer data wins)
        for (const item of newItems) map.set(item.id, item);

        const merged = Array.from(map.values());
        const data: DailyData = { date, fetchedAt: new Date().toISOString(), items: merged };
        writeFileSync(join(this.dataDir, `${date}.json`), JSON.stringify(data, null, 2), "utf-8");
    }

    load(date: string): NewsItem[] {
        const path = join(this.dataDir, `${date}.json`);
        if (!existsSync(path)) return [];
        const data = JSON.parse(readFileSync(path, "utf-8")) as DailyData & { items: (NewsItem & { createdAt: string })[] };
        return data.items.map((item) => ({ ...item, createdAt: new Date(item.createdAt) }));
    }

    /** Load all accumulated items for today (for scoring from the full pool). */
    loadAll(date: string, newItems: NewsItem[]): NewsItem[] {
        const existing = this.load(date);
        const map = new Map<string, NewsItem>();

        for (const item of existing) map.set(item.id, item);
        for (const item of newItems) map.set(item.id, item);

        return Array.from(map.values());
    }

    getRecentIds(hours: number, excludeDate?: string): Set<string> {
        const ids = new Set<string>();
        const cutoff = Date.now() - hours * 3_600_000;
        if (!existsSync(this.dataDir)) return ids;

        for (const file of readdirSync(this.dataDir).filter((f) => f.endsWith(".json"))) {
            // Skip today's file — today's pool is built via loadAll, not skipIds
            if (excludeDate && file === `${excludeDate}.json`) continue;
            try {
                const raw = readFileSync(join(this.dataDir, file), "utf-8");
                const data = JSON.parse(raw) as DailyData;
                if (new Date(data.fetchedAt).getTime() < cutoff) continue;
                for (const item of data.items) ids.add(item.id);
            } catch { /* skip corrupt */ }
        }
        return ids;
    }
}
