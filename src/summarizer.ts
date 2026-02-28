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
        const text = (content.trim() || title).slice(0, 3000);
        const system = `Rewrite the text into a concise summary in ${language}. Return 1–3 sentences (30–180 words). Retain the deep meaning. Be creative, be fun.`;
        const user = `Title: ${title}\nContent: ${text}`;
        return this.chat(system, user);
    }

    async summarizeAll(items: NewsItem[], language = "Chinese"): Promise<string> {
        if (items.length === 0) return "";
        const listing = items.slice(0, 10)
            .map((it) => `- ${it.title} (${it.category}, ${it.points} pts)`)
            .join("\n");
        const system = `Write a summary in ${language}, 3–5 sentences. Retain deep meaning. Be creative, be fun.`;
        const user = `Top items:\n${listing}\nTask: Summarize today's highlights. Plain text, no links.`;
        return this.chat(system, user);
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
