import type { DatabricksDataAdapter } from "../adapters/databricks-adapter";

export function escapeSqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export interface SystemAiQueryOptions {
    readonly endpoint: string;
    readonly prompt: string;
}

export interface SystemAiClassifyOptions {
    readonly text: string;
    readonly categories: readonly string[];
}

export interface SystemAiExtractOptions {
    readonly text: string;
    readonly labels: readonly string[];
}

export interface SystemAiMaskOptions {
    readonly text: string;
    readonly entities: readonly string[];
}

export class DatabricksSystemAiClient {
    constructor(private readonly adapter: DatabricksDataAdapter) {}

    async aiQuery(options: SystemAiQueryOptions): Promise<string> {
        const escapedEndpoint = escapeSqlLiteral(options.endpoint);
        const escapedPrompt = escapeSqlLiteral(options.prompt);
        const sql = `SELECT ai_query(${escapedEndpoint}, ${escapedPrompt}) AS response`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return "";
        const val = firstRow.response ?? Object.values(firstRow)[0];
        return String(val ?? "");
    }

    async aiSummarize(text: string, maxWords?: number): Promise<string> {
        const escapedText = escapeSqlLiteral(text);
        const args = maxWords ? `${escapedText}, ${maxWords}` : escapedText;
        const sql = `SELECT ai_summarize(${args}) AS summary`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return "";
        const val = firstRow.summary ?? Object.values(firstRow)[0];
        return String(val ?? "");
    }

    async aiClassify(options: SystemAiClassifyOptions): Promise<string> {
        const escapedText = escapeSqlLiteral(options.text);
        const categoriesList = `ARRAY(${options.categories.map((c) => escapeSqlLiteral(c)).join(", ")})`;
        const sql = `SELECT ai_classify(${escapedText}, ${categoriesList}) AS category`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return "";
        const val = firstRow.category ?? Object.values(firstRow)[0];
        return String(val ?? "");
    }

    async aiExtract(options: SystemAiExtractOptions): Promise<Record<string, unknown>> {
        const escapedText = escapeSqlLiteral(options.text);
        const labelsList = `ARRAY(${options.labels.map((l) => escapeSqlLiteral(l)).join(", ")})`;
        const sql = `SELECT ai_extract(${escapedText}, ${labelsList}) AS extraction`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return {};
        const val = firstRow.extraction ?? Object.values(firstRow)[0];
        if (typeof val === "string") {
            try {
                return JSON.parse(val) as Record<string, unknown>;
            } catch {
                return { raw: val };
            }
        }
        if (typeof val === "object" && val !== null) return val as Record<string, unknown>;
        return { value: val };
    }

    async aiSimilarity(text1: string, text2: string): Promise<number> {
        const escaped1 = escapeSqlLiteral(text1);
        const escaped2 = escapeSqlLiteral(text2);
        const sql = `SELECT ai_similarity(${escaped1}, ${escaped2}) AS similarity`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return 0;
        const val = firstRow.similarity ?? Object.values(firstRow)[0];
        if (val === null || val === undefined) return 0;
        const num = Number(val);
        return Number.isNaN(num) ? 0 : num;
    }

    async aiMask(options: SystemAiMaskOptions): Promise<string> {
        const escapedText = escapeSqlLiteral(options.text);
        const entitiesList = `ARRAY(${options.entities.map((e) => escapeSqlLiteral(e)).join(", ")})`;
        const sql = `SELECT ai_mask(${escapedText}, ${entitiesList}) AS masked`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return "";
        const val = firstRow.masked ?? Object.values(firstRow)[0];
        return String(val ?? "");
    }

    async aiAnalyzeSentiment(text: string): Promise<string> {
        const escapedText = escapeSqlLiteral(text);
        const sql = `SELECT ai_analyze_sentiment(${escapedText}) AS sentiment`;
        const res = await this.adapter.query(sql, 1);
        const firstRow = res.rows[0];
        if (!firstRow) return "";
        const val = firstRow.sentiment ?? Object.values(firstRow)[0];
        return String(val ?? "");
    }
}
