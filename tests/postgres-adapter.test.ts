import { describe, expect, test } from "bun:test";
import { DatabricksLakePostgresAdapter, type PostgresClientBackend, type PostgresQueryResultRow } from "../src/adapters/postgres-adapter";

describe("DatabricksLakePostgresAdapter", () => {
    test("query limits rows and measures execution time", async () => {
        let sentSql = "";
        const mockClient: PostgresClientBackend = {
            unsafe: async (sql: string) => {
                sentSql = sql;
                return [
                    { id: 1, name: "Alpha", amount: 100 },
                    { id: 2, name: "Beta", amount: 200 },
                ];
            },
        };

        const adapter = new DatabricksLakePostgresAdapter(mockClient);
        const res = await adapter.query("SELECT * FROM test_table", 50);

        expect(res.rowCount).toBe(2);
        expect(res.columns).toEqual(["id", "name", "amount"]);
        expect(sentSql).toContain("LIMIT 50");
        expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
        expect(adapter.source).toBe("lakehouse-postgres");
    });

    test("calculateMetric correlation computes pearson correlation over double precision", async () => {
        let corrSql = "";
        const mockClient: PostgresClientBackend = {
            unsafe: async (sql: string) => {
                corrSql = sql;
                return [{ corr: 0.84567, count: 150 }];
            },
        };

        const adapter = new DatabricksLakePostgresAdapter(mockClient, "metrics_table");
        const res = await adapter.calculateMetric("correlation", {
            colA: "marketing_spend",
            colB: "conversions",
        });

        expect(corrSql).toContain('corr("marketing_spend"::double precision, "conversions"::double precision)');
        if ("metric" in res) {
            expect(res.metric).toBe("pearson_correlation");
            expect(res.correlation).toBe(0.8457);
            expect(res.strength).toBe("strong");
            expect(res.direction).toBe("positive");
            expect(res.sampleSize).toBe(150);
        } else {
            throw new Error("Expected correlation result");
        }
    });

    test("calculateMetric percentiles computes p25, p50, p75, p90, p99", async () => {
        let percSql = "";
        const mockClient: PostgresClientBackend = {
            unsafe: async (sql: string) => {
                percSql = sql;
                return [{
                    count: 500,
                    p25: 12.5,
                    p50: 25.0,
                    p75: 50.0,
                    p90: 85.0,
                    p99: 150.0,
                }];
            },
        };

        const adapter = new DatabricksLakePostgresAdapter(mockClient, "events_table");
        const res = await adapter.calculateMetric("percentiles", {
            col: "duration_ms",
        });

        expect(percSql).toContain("percentile_cont(0.50) WITHIN GROUP");
        expect(res.column).toBe("duration_ms");
        expect(res.p50_median).toBe(25.0);
        expect(res.p90).toBe(85.0);
        expect(res.p99).toBe(150.0);
    });

    test("loadCsv creates table and inserts rows", async () => {
        const executed: string[] = [];
        const mockClient: PostgresClientBackend = {
            unsafe: async (sql: string) => {
                executed.push(sql);
                if (sql.includes("COUNT(*)")) return [{ count: 2 }];
                if (sql.includes("information_schema.columns")) {
                    return [
                        { column_name: "user_id", data_type: "text" },
                        { column_name: "score", data_type: "integer" },
                    ];
                }
                if (sql.includes("null_count")) return [{ null_count: 0, distinct_count: 2 }];
                if (sql.includes("LIMIT 5")) return [{ val: "u1" }, { val: "u2" }];
                return [];
            },
        };

        const adapter = new DatabricksLakePostgresAdapter(mockClient);
        const csv = `user_id,score\nu1,95\nu2,88`;
        const profile = await adapter.loadCsv("users", csv);

        expect(profile.tableName).toBe("users");
        expect(profile.rowCount).toBe(2);
        expect(profile.columns.length).toBe(2);
        expect(executed.some((s) => s.includes('CREATE TABLE "users"'))).toBe(true);
        expect(executed.some((s) => s.includes("INSERT INTO \"users\" VALUES ('u1', '95')"))).toBe(true);
    });
});
