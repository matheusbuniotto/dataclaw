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

export interface SqlitePreparedStatement {
    run(...params: unknown[]): unknown;
    all?(...params: unknown[]): unknown[];
}

export interface SqliteDatabaseBackend {
    exec?(sql: string): void;
    run?(sql: string): void;
    prepare(sql: string): SqlitePreparedStatement;
    query?(sql: string): {
        all(...params: unknown[]): unknown[];
    };
    transaction?<Args extends readonly unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
    close?(): void;
}

function toScalarNumber(val: unknown, fallback = 0): number {
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
}

export class SqliteDataAdapter implements DataAdapter {
    readonly source = "local" as const;

    private readonly db: SqliteDatabaseBackend;
    private activeTableName = "data";

    private constructor(db: SqliteDatabaseBackend) {
        this.db = db;
    }

    public static async create(pathOrMemory: string = ":memory:"): Promise<SqliteDataAdapter> {
        const isBun = typeof globalThis === "object" && globalThis !== null && "Bun" in globalThis;
        if (isBun) {
            const { Database } = await import("bun:sqlite");
            const db = new Database(pathOrMemory) as unknown as SqliteDatabaseBackend;
            return new SqliteDataAdapter(db);
        } else {
            const { DatabaseSync } = await import("node:sqlite");
            const db = new DatabaseSync(pathOrMemory) as unknown as SqliteDatabaseBackend;
            return new SqliteDataAdapter(db);
        }
    }

    public async loadCsv(tableName: string, csvContent: string): Promise<DatasetProfile> {
        this.activeTableName = tableName;
        const lines = csvContent.trim().split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) {
            throw new Error("CSV content is empty");
        }

        const firstLine = lines[0] ?? "";
        // Auto-detect delimiter: check counts of comma, semicolon, tab outside quotes
        const countDelimiter = (line: string, delim: string): number => {
            let count = 0;
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' || char === "'") inQuotes = !inQuotes;
                else if (char === delim && !inQuotes) count++;
            }
            return count;
        };

        const commaCount = countDelimiter(firstLine, ",");
        const tabCount = countDelimiter(firstLine, "\t");
        const semiCount = countDelimiter(firstLine, ";");
        const delimiter = (tabCount > commaCount && tabCount > semiCount) ? "\t"
            : (semiCount > commaCount) ? ";"
            : ",";

        const parseLine = (line: string): string[] => {
            const result: string[] = [];
            let cur = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' || char === "'") {
                    inQuotes = !inQuotes;
                } else if (char === delimiter && !inQuotes) {
                    result.push(cur.trim());
                    cur = "";
                } else {
                    cur += char;
                }
            }
            result.push(cur.trim());
            return result;
        };

        const headers = parseLine(firstLine).map((h) => h.replace(/[^a-zA-Z0-9_]/g, "_"));
        const dataRows = lines.slice(1).map(parseLine);

        // Infer types
        const colTypes: Record<string, "INTEGER" | "REAL" | "TEXT"> = {};
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            const col = headers[colIdx];
            if (!col) continue;
            let isInteger = true;
            let isReal = true;
            for (const row of dataRows) {
                const val = row[colIdx];
                if (val === "" || val === undefined || val === "null" || val === "NULL") continue;
                if (!/^-?\d+$/.test(val)) isInteger = false;
                if (!/^-?\d+(\.\d+)?$/.test(val)) isReal = false;
            }
            colTypes[col] = isInteger ? "INTEGER" : isReal ? "REAL" : "TEXT";
        }

        // Drop & Create table
        this.executeRaw(`DROP TABLE IF EXISTS "${tableName}";`);
        const colDefs = headers.map((h) => `"${h}" ${colTypes[h] ?? "TEXT"}`).join(", ");
        this.executeRaw(`CREATE TABLE "${tableName}" (${colDefs});`);

        // Insert rows
        const placeholders = headers.map(() => "?").join(", ");
        const insertSql = `INSERT INTO "${tableName}" VALUES (${placeholders});`;

        if (this.db.transaction) {
            // Bun or sqlite with transaction helper
            const stmt = this.db.prepare(insertSql);
            const insertMany = this.db.transaction((rows: string[][]) => {
                for (const row of rows) {
                    const typedRow = row.map((val, idx) => {
                        const col = headers[idx];
                        if (val === "" || val === undefined || val === "null" || val === "NULL") return null;
                        const colType = col ? colTypes[col] : undefined;
                        if (colType === "INTEGER") return parseInt(val, 10);
                        if (colType === "REAL") return parseFloat(val);
                        return val;
                    });
                    stmt.run(...typedRow);
                }
            });
            insertMany(dataRows);
        } else {
            // Fallback
            for (const row of dataRows) {
                const typedRow = row.map((val, idx) => {
                    const col = headers[idx];
                    if (val === "" || val === undefined || val === "null" || val === "NULL") return null;
                    const colType = col ? colTypes[col] : undefined;
                    if (colType === "INTEGER") return parseInt(val, 10);
                    if (colType === "REAL") return parseFloat(val);
                    return val;
                });
                this.db.prepare(insertSql).run(...typedRow);
            }
        }

        return this.profile(tableName);
    }

    public async loadJson(tableName: string, jsonContent: string): Promise<DatasetProfile> {
        this.activeTableName = tableName;
        let records: Array<Record<string, unknown>> = [];
        const trimmed = jsonContent.trim();

        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                const parsed: unknown = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    records = parsed.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
                } else if (parsed && typeof parsed === "object") {
                    // Check if the object wraps an array of records (e.g., { data: [...], records: [...] })
                    const innerArray = Object.values(parsed).find(
                        (v): v is Array<Record<string, unknown>> => Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null
                    );
                    records = innerArray
                        ? innerArray
                        : [parsed as Record<string, unknown>];
                }
            } catch {
                // If standard JSON parse fails, it may be JSONL with leading object
            }
        }

        if (records.length === 0) {
            // Attempt line-by-line JSONL / NDJSON parse
            const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
            for (const line of lines) {
                try {
                    const parsedLine: unknown = JSON.parse(line.trim());
                    if (parsedLine && typeof parsedLine === "object" && !Array.isArray(parsedLine)) {
                        records.push(parsedLine as Record<string, unknown>);
                    }
                } catch {
                    // Skip malformed individual line in JSONL
                }
            }
        }

        if (records.length === 0) {
            throw new Error("JSON content contains no records");
        }

        const keys = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
        const colTypes: Record<string, "INTEGER" | "REAL" | "TEXT"> = {};

        for (const k of keys) {
            let isInt = true;
            let isReal = true;
            for (const r of records) {
                const val = r[k];
                if (val === null || val === undefined) continue;
                if (typeof val === "number") {
                    if (!Number.isInteger(val)) isInt = false;
                } else {
                    isInt = false;
                    isReal = false;
                }
            }
            colTypes[k] = isInt ? "INTEGER" : isReal ? "REAL" : "TEXT";
        }

        this.executeRaw(`DROP TABLE IF EXISTS "${tableName}";`);
        const colDefs = keys.map((k) => `"${k}" ${colTypes[k] ?? "TEXT"}`).join(", ");
        this.executeRaw(`CREATE TABLE "${tableName}" (${colDefs});`);

        const placeholders = keys.map(() => "?").join(", ");
        const insertSql = `INSERT INTO "${tableName}" VALUES (${placeholders});`;
        const stmt = this.db.prepare(insertSql);

        for (const r of records) {
            const values = keys.map((k) => {
                const val = r[k];
                if (val === null || val === undefined) return null;
                if (typeof val === "object") return JSON.stringify(val);
                return val;
            });
            stmt.run(...values);
        }

        return this.profile(tableName);
    }

    public async profile(tableName?: string): Promise<DatasetProfile> {
        const table = tableName ?? this.activeTableName;
        const countRes = this.queryAll(`SELECT COUNT(*) as count FROM "${table}";`);
        const rowCount = toScalarNumber(countRes[0]?.count, 0);

        const pragmaCols = this.queryAll(`PRAGMA table_info("${table}");`);
        const columns: ColumnProfile[] = [];

        for (const col of pragmaCols) {
            const name = typeof col.name === "string" ? col.name : "";
            if (!name) continue;
            const rawType = typeof col.type === "string" ? col.type.toUpperCase() : "TEXT";
            const type: ColumnProfile["type"] = rawType === "INTEGER" || rawType === "REAL" ? rawType : "TEXT";

            const nullRes = this.queryAll(`SELECT COUNT(*) as n FROM "${table}" WHERE "${name}" IS NULL;`);
            const nullCount = toScalarNumber(nullRes[0]?.n, 0);
            const nullPct = rowCount > 0 ? Number(((nullCount / rowCount) * 100).toFixed(2)) : 0;

            const distinctRes = this.queryAll(`SELECT COUNT(DISTINCT "${name}") as d FROM "${table}";`);
            const distinctCount = toScalarNumber(distinctRes[0]?.d, 0);

            const sampleRes = this.queryAll(`SELECT DISTINCT "${name}" as s FROM "${table}" WHERE "${name}" IS NOT NULL LIMIT 5;`);
            const sampleValues = sampleRes.map((r) => r.s);

            let min: number | string | undefined;
            let max: number | string | undefined;
            let mean: number | undefined;

            if (type === "INTEGER" || type === "REAL") {
                const statsRes = this.queryAll(`SELECT MIN("${name}") as min_val, MAX("${name}") as max_val, AVG("${name}") as mean_val FROM "${table}";`);
                const firstStats = statsRes[0];
                if (firstStats) {
                    min = typeof firstStats.min_val === "number" || typeof firstStats.min_val === "string" ? firstStats.min_val : undefined;
                    max = typeof firstStats.max_val === "number" || typeof firstStats.max_val === "string" ? firstStats.max_val : undefined;
                    const rawMean = firstStats.mean_val;
                    mean = rawMean !== null && rawMean !== undefined ? Number(Number(rawMean).toFixed(3)) : undefined;
                }
            }

            columns.push({
                name,
                type,
                nullCount,
                nullPct,
                distinctCount,
                sampleValues,
                min,
                max,
                mean,
            });
        }

        return {
            tableName: table,
            rowCount,
            columnCount: columns.length,
            columns,
        };
    }

    public async query(sql: string, maxRows = 200): Promise<QueryResult> {
        const trimmed = sql.trim();
        // Prevent accidental multiple statements or table-dropping queries during read-only analysis
        const isSelect = /^SELECT\b/i.test(trimmed) || /^WITH\b/i.test(trimmed) || /^EXPLAIN\b/i.test(trimmed);
        if (!isSelect) {
            throw new Error("Only SELECT or read-only analytical queries are permitted.");
        }

        const start = performance.now();
        const rows = this.queryAll(trimmed);
        const executionTimeMs = Number((performance.now() - start).toFixed(2));

        const limitedRows = rows.slice(0, maxRows);
        const firstRow = limitedRows[0];
        const columns = firstRow ? Object.keys(firstRow) : [];

        return {
            columns,
            rows: limitedRows,
            rowCount: rows.length,
            executionTimeMs,
        };
    }

    public async calculateMetric(type: "correlation", options: CorrelationMetricOptions): Promise<CorrelationResult>;
    public async calculateMetric(type: "percentiles", options: PercentilesMetricOptions): Promise<PercentilesResult>;
    public async calculateMetric(type: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
    public async calculateMetric(type: string, options: Record<string, unknown>): Promise<Record<string, unknown>> {
        const table = (typeof options.tableName === "string" ? options.tableName : undefined) ?? this.activeTableName;

        if (type === "correlation") {
            const colA = typeof options.colA === "string" ? options.colA : "";
            const colB = typeof options.colB === "string" ? options.colB : "";
            if (!colA || !colB) throw new Error("Correlation requires colA and colB strings.");

            const q = `
                SELECT 
                    COUNT(*) as n,
                    AVG("${colA}") as avg_a,
                    AVG("${colB}") as avg_b
                FROM "${table}"
                WHERE "${colA}" IS NOT NULL AND "${colB}" IS NOT NULL;
            `;
            const stats = this.queryAll(q)[0];
            const n = toScalarNumber(stats?.n, 0);
            if (n <= 1) return { correlation: 0, sampleSize: n, note: "Sample size too small" };

            const avgA = toScalarNumber(stats?.avg_a, 0);
            const avgB = toScalarNumber(stats?.avg_b, 0);

            const covQ = `
                SELECT 
                    SUM(("${colA}" - ${avgA}) * ("${colB}" - ${avgB})) as cov,
                    SUM(("${colA}" - ${avgA}) * ("${colA}" - ${avgA})) as var_a,
                    SUM(("${colB}" - ${avgB}) * ("${colB}" - ${avgB})) as var_b
                FROM "${table}"
                WHERE "${colA}" IS NOT NULL AND "${colB}" IS NOT NULL;
            `;
            const covRes = this.queryAll(covQ)[0];
            const cov = toScalarNumber(covRes?.cov, 0);
            const varA = toScalarNumber(covRes?.var_a, 0);
            const varB = toScalarNumber(covRes?.var_b, 0);

            const denom = Math.sqrt(varA * varB);
            const r = denom === 0 ? 0 : cov / denom;

            return {
                metric: "pearson_correlation",
                columns: [colA, colB],
                sampleSize: n,
                correlation: Number(r.toFixed(4)),
                strength: Math.abs(r) > 0.7 ? "strong" : Math.abs(r) > 0.4 ? "moderate" : "weak",
                direction: r > 0 ? "positive" : "negative",
            } satisfies CorrelationResult;
        }

        if (type === "percentiles") {
            const col = typeof options.col === "string" ? options.col : typeof options.colA === "string" ? options.colA : "";
            if (!col) throw new Error("Percentiles require a col string.");

            const rows = this.queryAll(`SELECT "${col}" as val FROM "${table}" WHERE "${col}" IS NOT NULL ORDER BY "${col}" ASC;`);
            if (rows.length === 0) return { error: "No numerical values found" } satisfies PercentilesResult;

            const vals = rows.map((r) => Number(r.val)).filter(Number.isFinite);
            if (vals.length === 0) return { error: "No numerical values found" } satisfies PercentilesResult;

            const getP = (p: number): number | undefined => {
                const idx = Math.floor((p / 100) * (vals.length - 1));
                return vals[idx];
            };

            return {
                column: col,
                count: vals.length,
                p25: getP(25),
                p50_median: getP(50),
                p75: getP(75),
                p90: getP(90),
                p99: getP(99),
            } satisfies PercentilesResult;
        }

        throw new Error(`Unsupported metric type: ${type}`);
    }

    public async close(): Promise<void> {
        if (this.db.close) {
            this.db.close();
        }
    }

    private executeRaw(sql: string): void {
        if (this.db.exec) {
            this.db.exec(sql);
        } else if (this.db.run) {
            this.db.run(sql);
        }
    }

    private queryAll(sql: string): Array<Record<string, unknown>> {
        if (this.db.query) {
            // Bun sqlite
            const res = this.db.query(sql).all();
            return res.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        } else if (this.db.prepare) {
            // node:sqlite DatabaseSync
            const stmt = this.db.prepare(sql);
            const res = stmt.all ? stmt.all() : [];
            return res.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        }
        throw new Error("Unable to execute query against database");
    }
}
