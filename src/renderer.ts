import type { SummarizedItem } from "./types";

interface RenderData {
    title: string;
    date: string;
    summary: string;
    items: SummarizedItem[];
}

function escapeYaml(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

export function renderMarkdown(data: RenderData): string {
    const lines: string[] = [];

    // Frontmatter
    lines.push("---");
    lines.push(`title: "${escapeYaml(data.title)}"`);
    lines.push(`date: ${data.date}`);
    if (data.summary) {
        const short = data.summary.slice(0, 100).split("\n")[0] ?? "";
        lines.push(`summary: "${escapeYaml(short)}..."`);
    }
    lines.push("---");
    lines.push("");

    // Overall summary
    if (data.summary) {
        lines.push(data.summary);
        lines.push("");
    }

    // Items
    for (const { item, description } of data.items) {
        lines.push(`## [${item.title}](${item.url})`);
        lines.push("");

        if (description) {
            lines.push(description);
            lines.push("");
        }

        const time = item.createdAt.toISOString().slice(0, 16).replace("T", " ");

        if (item.source === "hackernews") {
            const hnUrl = `https://news.ycombinator.com/item?id=${item.id}`;
            lines.push(`*${item.points} 分 · ${item.replies} 评论 · [HN 讨论](${hnUrl}) · ${time} · by ${item.author}*`);
        } else {
            const nodeUrl = `https://www.v2ex.com/go/${item.category}`;
            lines.push(`*${item.replies} 回复 · [@${item.category}](${nodeUrl}) · ${time} · by ${item.author}*`);
        }
        lines.push("");
    }

    return lines.join("\n");
}
