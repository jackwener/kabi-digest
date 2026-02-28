import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { AppConfig } from "./types";

const DEFAULTS: AppConfig = {
    ai: {
        provider: "openai",
        apiKey: "",
        model: "gpt-4o-mini",
        baseUrl: "",
    },
    hackernews: {
        enabled: true,
        lists: ["top"],
        limit: 30,
        topN: 20,
    },
    v2ex: {
        enabled: true,
        token: "",
        nodes: ["hot"],
        excludeNodes: ["promotions", "deals", "cv", "exchange"],
        topN: 20,
        pages: 3,
    },
    skipHours: 72,
    extractor: {
        enabled: true,
        concurrency: 3,
        maxLength: 5000,
        timeout: 15000,
    },
};

function snakeToCamel(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(snakeToCamel);
    if (obj && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
            result[camelKey] = snakeToCamel(value);
        }
        return result;
    }
    return obj;
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        const sv = source[key];
        if (sv && typeof sv === "object" && !Array.isArray(sv) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key] as any, sv as any);
        } else if (sv !== undefined) {
            result[key] = sv as any;
        }
    }
    return result;
}

const ROOT_DIR = resolve(import.meta.dir, "..");

export function loadConfig(): AppConfig {
    let config = { ...DEFAULTS } as AppConfig;

    const configPath = resolve(ROOT_DIR, "config.yaml");
    if (existsSync(configPath)) {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = YAML.parse(raw) ?? {};
        const normalized = snakeToCamel(parsed) as Partial<AppConfig>;
        config = deepMerge(config, normalized);
    }

    // Env fallbacks
    if (!config.ai.apiKey) {
        config.ai.apiKey =
            process.env.OPENAI_API_KEY ||
            process.env.ANTHROPIC_API_KEY ||
            "";
    }
    if (!config.v2ex.token) {
        config.v2ex.token = process.env.V2EX_TOKEN || "";
    }

    return config;
}

export { ROOT_DIR };
