import type {
    ColumnProfile,
    CorrelationMetricOptions,
    CorrelationResult,
    DataAdapter,
    DatasetProfile,
    PercentilesMetricOptions,
    PercentilesResult,
    QueryResult,
} from "./adapter-interface";
import type { LakePostgresConfig } from "../mcp/databricks-env";

export interface PostgresQueryResultRow {
    [key: string]: unknown;
}

export interface PostgresClientBackend {
    unsafe(query: string, params?: unknown[]): Promise<PostgresQueryResultRow[]>;
    close?(): Promise<void> | void;
}

export class DatabricksLakePostgresAdapter implements DataAdapter {
    readonly source = "lakehouse-postgres" as const;

    private readonly client: PostgresClientBackend;
    private activeTableName = "data";

    constructor(client: PostgresClientBackend, initialTable = "data") {
        this.client = client;
        this.activeTableName = initialTable;
    }

    public static createFromConfig(config: LakePostgresConfig): DatabricksLakePostgresAdapter {
        const isBun = typeof globalThis === "object" && globalThis !== null && "Bun" in globalThis;
        if (!isBun) {
            throw new Error("Databricks Lakehouse Postgres adapter requires Bun runtime");
        }

        const BunGlobal = globalThis as unknown as {
            Bun: {
                SQL: new (options: {
                    hostname?: string;
                    port?: number;
                    database?: string;
                    username?: string;
                    password?: string;
                    tls?: boolean;
                    url?: string;
                }) => PostgresClientBackend;
            };
        };

        const client = config.url
            ? new BunGlobal.Bun.SQL({ url: config.url })
            : new BunGlobal.Bun.SQL({
                  hostname: config.host,
                  port: config.port,
                  database: config.database,
                  username: config.username,
                  password: config.password,
                  tls: config.ssl === "require" || config.ssl === true,
              });

        return new DatabricksLakePostgresAdapter(client);
    }

    public async query(sql: string, maxRows = 1000): Promise<QueryResult> {
        const start = performance.now();
        const trimmed = sql.trim().replace(/;+$/, "");
        const limitedSql = trimmed.toUpperCase().includes("LIMIT") ? trimmed : `${trimmed} LIMIT ${maxRows}`;

        const rows = await this.client.unsafe(limitedSql);
        const executionTimeMs = performance.now() - start;

        const firstRow = rows[0];
        const columns = firstRow ? Object.keys(firstRow) : [];

        return {
            columns,
            rows,
            rowCount: rows.length,
            executionTimeMs,
        };
    }

    public async loadCsv(tableName: string, csvContent: string): Promise<DatasetProfile> {
        this.activeTableName = tableName;
        const lines = csvContent.trim().split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) {
            throw new Error("CSV content is empty");
        }

        const headerLine = lines[0];
        if (!headerLine) {
            throw new Error("CSV has no header row");
        }

        const headers = headerLine.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
        const quotedHeaders = headers.map((h) => `"${h.replace(/"/g, '""')}" TEXT`).join(", ");

        await this.client.unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
        await this.client.unsafe(`CREATE TABLE "${tableName}" (${quotedHeaders})`);

        for (let i = 1; i < lines.length; i++) {
            const rowLine = lines[i];
            if (!rowLine) continue;
            const values = rowLine.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
            const escaped = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
            await this.client.unsafe(`INSERT INTO "${tableName}" VALUES (${escaped})`);
        }

        return this.profile(tableName);
    }

    public async loadJson(tableName: string, jsonContent: string): Promise<DatasetProfile> {
        this.activeTableName = tableName;
        const parsed = JSON.parse(jsonContent) as unknown;
        const items = Array.isArray(parsed) ? parsed : [parsed];
        if (items.length === 0) {
            throw new Error("JSON content is empty");
        }

        const first = items[0] as Record<string, unknown>;
        const keys = Object.keys(first);
        const cols = keys.map((k) => `"${k.replace(/"/g, '""')}" TEXT`).join(", ");

        await this.client.unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
        await this.client.unsafe(`CREATE TABLE "${tableName}" (${cols})`);

        for (const item of items) {
            const record = item as Record<string, unknown>;
            const vals = keys.map((k) => {
                const v = record[k];
                if (v === null || v === undefined) return "NULL";
                return `'${String(v).replace(/'/g, "''")}'`;
            });
            await this.client.unsafe(`INSERT INTO "${tableName}" VALUES (${vals.join(", ")})`);
        }

        return this.profile(tableName);
    }

    public async profile(tableName?: string): Promise<DatasetProfile> {
        const table = tableName ?? this.activeTableName;

        const countRes = await this.client.unsafe(`SELECT COUNT(*) as count FROM "${table}"`);
        const rowCount = Number(countRes[0]?.count ?? 0);

        const colRes = await this.client.unsafe(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '${table.replace(/'/g, "''")}'
            ORDER BY ordinal_position
        `);

        const columns: ColumnProfile[] = [];

        for (const col of colRes) {
            const colName = String(col.column_name);
            const rawType = String(col.data_type).toLowerCase();
            const type: "INTEGER" | "REAL" | "TEXT" =
                rawType.includes("int") || rawType.includes("bigint")
                    ? "INTEGER"
                    : rawType.includes("float") || rawType.includes("double") || rawType.includes("numeric")
                    ? "REAL"
                    : "TEXT";

            const statsRes = await this.client.unsafe(`
                SELECT 
                    COUNT(*) FILTER (WHERE "${colName}" IS NULL) as null_count,
                    COUNT(DISTINCT "${colName}") as distinct_count
                FROM "${table}"
            `);

            const nullCount = Number(statsRes[0]?.null_count ?? 0);
            const distinctCount = Number(statsRes[0]?.distinct_count ?? 0);
            const nullPct = rowCount > 0 ? (nullCount / rowCount) * 100 : 0;

            const sampleRes = await this.client.unsafe(`
                SELECT "${colName}" as val 
                FROM "${table}" 
                WHERE "${colName}" IS NOT NULL 
                LIMIT 5
            `);
            const sampleValues = sampleRes.map((r) => r.val);

            columns.push({
                name: colName,
                type,
                nullCount,
                nullPct,
                distinctCount,
                sampleValues,
            });
        }

        return {
            tableName: table,
            rowCount,
            columnCount: columns.length,
            columns,
        };
    }

    async calculateMetric(type: "correlation", options: CorrelationMetricOptions): Promise<CorrelationResult>;
    async calculateMetric(type: "percentiles", options: PercentilesMetricOptions): Promise<PercentilesResult>;
    async calculateMetric(type: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
    async calculateMetric(
        type: string,
        options: Record<string, unknown>,
    ): Promise<CorrelationResult | PercentilesResult | Record<string, unknown>> {
        const table = (options.tableName as string | undefined) ?? this.activeTableName;

        if (type === "correlation") {
            const colA = String(options.colA);
            const colB = String(options.colB);

            try {
                const res = await this.client.unsafe(`
                    SELECT 
                        corr("${colA}"::double precision, "${colB}"::double precision) as corr,
                        COUNT(*) as count
                    FROM "${table}"
                    WHERE "${colA}" IS NOT NULL AND "${colB}" IS NOT NULL
                `);

                const rawCorr = Number(res[0]?.corr);
                const sampleSize = Number(res[0]?.count ?? 0);

                if (Number.isNaN(rawCorr) || !Number.isFinite(rawCorr)) {
                    return {
                        correlation: 0,
                        sampleSize,
                        note: "Insufficient variance or numeric data to calculate correlation",
                    };
                }

                const absCorr = Math.abs(rawCorr);
                const strength = absCorr >= 0.7 ? "strong" : absCorr >= 0.3 ? "moderate" : "weak";
                const direction = rawCorr >= 0 ? "positive" : "negative";

                return {
                    metric: "pearson_correlation",
                    columns: [colA, colB] as const,
                    sampleSize,
                    correlation: Number(rawCorr.toFixed(4)),
                    strength,
                    direction,
                };
            } catch (err) {
                return {
                    correlation: 0,
                    sampleSize: 0,
                    note: `Postgres correlation error: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }

        if (type === "percentiles") {
            const col = String(options.col ?? options.colA);
            try {
                const res = await this.client.unsafe(`
                    SELECT 
                        COUNT("${col}") as count,
                        percentile_cont(0.25) WITHIN GROUP (ORDER BY "${col}"::double precision) as p25,
                        percentile_cont(0.50) WITHIN GROUP (ORDER BY "${col}"::double precision) as p50,
                        percentile_cont(0.75) WITHIN GROUP (ORDER BY "${col}"::double precision) as p75,
                        percentile_cont(0.90) WITHIN GROUP (ORDER BY "${col}"::double precision) as p90,
                        percentile_cont(0.99) WITHIN GROUP (ORDER BY "${col}"::double precision) as p99
                    FROM "${table}"
                    WHERE "${col}" IS NOT NULL
                `);

                const r = res[0];
                return {
                    column: col,
                    count: Number(r?.count ?? 0),
                    p25: r?.p25 !== null && r?.p25 !== undefined ? Number(r.p25) : undefined,
                    p50_median: r?.p50 !== null && r?.p50 !== undefined ? Number(r.p50) : undefined,
                    p75: r?.p75 !== null && r?.p75 !== undefined ? Number(r.p75) : undefined,
                    p90: r?.p90 !== null && r?.p90 !== undefined ? Number(r.p90) : undefined,
                    p99: r?.p99 !== null && r?.p99 !== undefined ? Number(r.p99) : undefined,
                };
            } catch (err) {
                return {
                    error: `Postgres percentiles error: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }

        return { error: `Unsupported metric type: ${type}` };
    }

    public async close(): Promise<void> {
        if (this.client.close) {
            await this.client.close();
        }
    }
}
