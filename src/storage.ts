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

    save(date: string, items: NewsItem[]): void {
        const data: DailyData = { date, fetchedAt: new Date().toISOString(), items };
        writeFileSync(join(this.dataDir, `${date}.json`), JSON.stringify(data, null, 2), "utf-8");
    }

    load(date: string): NewsItem[] {
        const path = join(this.dataDir, `${date}.json`);
        if (!existsSync(path)) return [];
        const data = JSON.parse(readFileSync(path, "utf-8")) as DailyData & { items: (NewsItem & { createdAt: string })[] };
        return data.items.map((item) => ({ ...item, createdAt: new Date(item.createdAt) }));
    }

    getRecentIds(hours: number): Set<string> {
        const ids = new Set<string>();
        const cutoff = Date.now() - hours * 3_600_000;
        if (!existsSync(this.dataDir)) return ids;

        for (const file of readdirSync(this.dataDir).filter((f) => f.endsWith(".json"))) {
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
