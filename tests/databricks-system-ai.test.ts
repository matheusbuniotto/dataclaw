import { describe, expect, test } from "bun:test";
import { DatabricksSystemAiClient } from "../src/mcp/databricks-system-ai";
import type { DatabricksDataAdapter } from "../src/adapters/databricks-adapter";

describe("DatabricksSystemAiClient", () => {
    test("aiQuery formats SQL and parses single row scalar", async () => {
        let executedSql = "";
        const mockAdapter = {
            query: async (sql: string) => {
                executedSql = sql;
                return {
                    columns: ["response"],
                    rows: [{ response: "Here is the synthesized customer pattern." }],
                    rowCount: 1,
                    executionTimeMs: 5,
                };
            },
        } as unknown as DatabricksDataAdapter;

        const client = new DatabricksSystemAiClient(mockAdapter);
        const res = await client.aiQuery({
            endpoint: "databricks-meta-llama-3-3-70b-instruct",
            prompt: "Summarize this segment",
        });

        expect(executedSql).toContain("ai_query('databricks-meta-llama-3-3-70b-instruct'");
        expect(res).toBe("Here is the synthesized customer pattern.");
    });

    test("aiSummarize, aiClassify, aiExtract and aiSimilarity format correct SQL", async () => {
        const sqls: string[] = [];
        const mockAdapter = {
            query: async (sql: string) => {
                sqls.push(sql);
                if (sql.includes("ai_similarity")) {
                    return { columns: ["similarity"], rows: [{ similarity: 0.89 }], rowCount: 1, executionTimeMs: 5 };
                }
                if (sql.includes("ai_classify")) {
                    return { columns: ["category"], rows: [{ category: "High-Intent" }], rowCount: 1, executionTimeMs: 5 };
                }
                if (sql.includes("ai_extract")) {
                    return {
                        columns: ["extraction"],
                        rows: [{ extraction: JSON.stringify({ segment: "Enterprise", mrr: 12000 }) }],
                        rowCount: 1,
                        executionTimeMs: 5,
                    };
                }
                return { columns: ["summary"], rows: [{ summary: "Short brief" }], rowCount: 1, executionTimeMs: 5 };
            },
        } as unknown as DatabricksDataAdapter;

        const client = new DatabricksSystemAiClient(mockAdapter);

        const summary = await client.aiSummarize("Long quarterly text", 50);
        expect(summary).toBe("Short brief");

        const category = await client.aiClassify({
            text: "Wants enterprise SLA",
            categories: ["SMB", "Mid-Market", "High-Intent"],
        });
        expect(category).toBe("High-Intent");

        const extracted = await client.aiExtract({
            text: "Acme Corp paying 12k monthly",
            labels: ["segment", "mrr"],
        });
        expect(extracted).toEqual({ segment: "Enterprise", mrr: 12000 });

        const similarity = await client.aiSimilarity("churn rate increased", "customer retention declined");
        expect(similarity).toBe(0.89);

        expect(sqls.some((s) => s.includes("ai_summarize"))).toBe(true);
        expect(sqls.some((s) => s.includes("ai_classify"))).toBe(true);
        expect(sqls.some((s) => s.includes("ai_extract"))).toBe(true);
        expect(sqls.some((s) => s.includes("ai_similarity"))).toBe(true);
    });
});
