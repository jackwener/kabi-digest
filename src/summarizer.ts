import OpenAI from "openai";
import type { NewsItem } from "./types";

interface SummarizerConfig {
    provider: "openai" | "anthropic";
    apiKey: string;
    model: string;
    baseUrl?: string;
}

export class Summarizer {
    private client?: OpenAI;
    private config: SummarizerConfig;

    constructor(config: SummarizerConfig) {
        this.config = config;
        if (config.provider !== "anthropic") {
            this.client = new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.baseUrl || "https://api.openai.com/v1",
            });
        }
    }

    async summarizeItem(title: string, content: string, language = "Chinese"): Promise<string> {
        const text = content.trim() || title;
        const chunks = this.chunkText(text, 6000);
        if (chunks.length <= 1) {
            const system = `Rewrite the text into a concise summary in ${language}. Return 1–3 sentences (30–180 words). Retain key details and main conclusions.`;
            const user = `Title: ${title}\nContent: ${chunks[0] || title}`;
            return this.chat(system, user);
        }

        const chunkSummaries: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
            const system = `Summarize this article chunk in ${language}. Keep only facts, arguments, and outcomes from this chunk. Return 2–4 short sentences.`;
            const user = `Title: ${title}\nChunk ${i + 1}/${chunks.length}:\n${chunks[i]}`;
            const summary = await this.chat(system, user);
            if (summary.trim()) chunkSummaries.push(summary.trim());
        }

        if (chunkSummaries.length === 0) return "";

        const merged = chunkSummaries.join("\n");
        const finalSystem = `Merge the chunk summaries into one coherent summary in ${language}. Return 1–3 sentences (40–220 words). Preserve important details.`;
        const finalUser = `Title: ${title}\nChunk summaries:\n${merged}`;
        return this.chat(finalSystem, finalUser);
    }

    async summarizeAll(items: NewsItem[], language = "Chinese"): Promise<string> {
        if (items.length === 0) return "";
        const listing = items.slice(0, 10)
            .map((it) => {
                const excerpt = it.content
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 220);
                return `- Title: ${it.title}
  Meta: (${it.category}, ${it.points} pts)
  Excerpt: ${excerpt || "(no content)"}`;
            })
            .join("\n");
        const system = `Write a summary in ${language}, 3–5 sentences. Retain deep meaning. Be creative, be fun.`;
        const user = `Top items:\n${listing}\nTask: Summarize today's highlights. Plain text, no links.`;
        return this.chat(system, user);
    }

    private chunkText(text: string, maxChars: number): string[] {
        const normalized = text.replace(/\r\n/g, "\n").trim();
        if (!normalized) return [""];
        if (normalized.length <= maxChars) return [normalized];

        const paragraphs = normalized.split(/\n{2,}/);
        const chunks: string[] = [];
        let current = "";

        for (const para of paragraphs) {
            const part = para.trim();
            if (!part) continue;
            if ((current + "\n\n" + part).trim().length <= maxChars) {
                current = current ? `${current}\n\n${part}` : part;
                continue;
            }
            if (current) chunks.push(current);
            if (part.length <= maxChars) {
                current = part;
                continue;
            }
            // Fallback for extremely long single paragraphs.
            for (let i = 0; i < part.length; i += maxChars) {
                chunks.push(part.slice(i, i + maxChars));
            }
            current = "";
        }
        if (current) chunks.push(current);
        return chunks.length > 0 ? chunks : [normalized.slice(0, maxChars)];
    }

    private async chat(system: string, user: string): Promise<string> {
        try {
            if (this.config.provider === "anthropic") {
                return await this.chatAnthropic(system, user);
            }
            return await this.chatOpenAI(system, user);
        } catch (err) {
            console.error("[AI] Chat failed:", err);
            return "";
        }
    }

    private async chatOpenAI(system: string, user: string): Promise<string> {
        const resp = await this.client!.chat.completions.create({
            model: this.config.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            temperature: 0.4,
        });
        return resp.choices[0]?.message?.content?.trim() ?? "";
    }

    private async chatAnthropic(system: string, user: string): Promise<string> {
        const baseUrl = (this.config.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
        const resp = await fetch(`${baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: this.config.model,
                max_tokens: 1024,
                system,
                messages: [{ role: "user", content: user }],
            }),
        });
        if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);
        const data = (await resp.json()) as any;
        return data.content?.find((c: any) => c.type === "text")?.text?.trim() ?? "";
    }
}
