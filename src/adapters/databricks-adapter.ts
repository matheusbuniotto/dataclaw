import type { ColumnProfile, DataAdapter, DatasetProfile, QueryResult } from "./adapter-interface";
import {
    resolveDatabricksConfig,
    type DatabricksConfigOverrides,
    type DatabricksMcpConfig,
} from "../mcp/databricks-config";
import {
    assertReadOnlySql,
    McpSqlClient,
    type ExecuteSqlOptions,
    type SqlExecutionResult,
    type SqlExecutor,
} from "../mcp/mcp-sql-client";
import { databricksDialect as dialect } from "../datasource/dialects";
import type { DescribedColumn } from "../datasource/types";

export type { DescribedColumn };

export interface DatabricksAdapterOptions {
    /** Default Unity Catalog table used when profile() is called without a name. */
    defaultTable?: string;
    /** Workspace host, exposed for prompt sections and the UI. */
    host?: string;
    /** MCP endpoint the adapter is bound to. */
    mcpUrl?: string;
    /** Databricks CLI profile used for auth, when applicable. */
    profile?: string;
    /** Optional SQL warehouse id. */
    warehouseId?: string;
    /** Async token source (OAuth refresh); overrides the static config token. */
    tokenProvider?: (force?: boolean) => string | Promise<string>;
}

/** Parse the rows returned by `DESCRIBE TABLE`. */
export function parseDescribeTableRows(rows: Array<Record<string, unknown>>): DescribedColumn[] {
    const columns: DescribedColumn[] = [];
    for (const row of rows) {
        const nameValue = row.col_name ?? row.COL_NAME ?? row.column_name ?? row.name;
        if (typeof nameValue !== "string") continue;
        const name = nameValue.trim();
        if (!name || name.startsWith("#")) continue;

        const dataTypeRaw = row.data_type ?? row.DATA_TYPE ?? row.type ?? "STRING";
        const dataType = String(dataTypeRaw).trim() || "STRING";
        columns.push({
            name,
            dataType,
            ...dialect.classify(dataType),
        });
    }
    return columns;
}

function toNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function toScalar(value: unknown): number | string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "number" || typeof value === "string") return value;
    return String(value);
}

/**
 * Read-only DataAdapter backed by a Databricks SQL MCP server.
 *
 * It profiles Unity Catalog tables with a DESCRIBE plus one aggregate query
 * (and an optional sample), executes read-only SQL, and computes metrics with native Databricks functions
 * (`corr`, `percentile_approx`). It never writes to the workspace.
 */
export class DatabricksDataAdapter implements DataAdapter {
    readonly source = "databricks" as const;

    private activeTableName?: string;

    constructor(
        private readonly executor: SqlExecutor,
        readonly options: DatabricksAdapterOptions = {},
    ) {
        this.activeTableName = options.defaultTable;
    }

    static async connect(
        config: DatabricksConfigOverrides = {},
        options: DatabricksAdapterOptions = {},
    ): Promise<DatabricksDataAdapter> {
        const tokenProvider = options.tokenProvider;
        const initialToken = tokenProvider ? await tokenProvider() : config.token;
        const resolved: DatabricksMcpConfig = resolveDatabricksConfig({
            ...config,
            ...(initialToken ? { token: initialToken } : {}),
        });
        const token = initialToken ?? resolved.token;
        const client = await McpSqlClient.connect({ ...resolved, token }, {
            // Re-resolve the token on auth failure so long-lived durable tasks survive expiry.
            tokenFactory: tokenProvider ?? (() => resolveDatabricksConfig(config).token),
        });
        return new DatabricksDataAdapter(client, {
            ...options,
            host: options.host ?? resolved.host,
            mcpUrl: options.mcpUrl ?? resolved.url,
            profile: options.profile ?? resolved.profile,
            warehouseId: options.warehouseId ?? resolved.warehouseId,
        });
    }

    /** Escape hatch for tests and custom transports. */
    static fromExecutor(executor: SqlExecutor, options: DatabricksAdapterOptions = {}): DatabricksDataAdapter {
        return new DatabricksDataAdapter(executor, options);
    }

    setActiveTable(tableName: string): void {
        this.activeTableName = tableName;
    }

    private sql(statement: string, options: ExecuteSqlOptions = {}): Promise<SqlExecutionResult> {
        return this.executor.execute(statement, options);
    }

    async loadCsv(_tableName: string, _csvContent: string): Promise<DatasetProfile> {
        throw new Error(
            "DatabricksDataAdapter is read-only and does not load local files. " +
            "Write the file to a Unity Catalog volume first, then query it with SQL.",
        );
    }

    async loadJson(_tableName: string, _jsonContent: string): Promise<DatasetProfile> {
        throw new Error(
            "DatabricksDataAdapter is read-only and does not load local files. " +
            "Write the file to a Unity Catalog volume first, then query it with SQL.",
        );
    }

    /** Last table profiled or explicitly selected via setActiveTable(). */
    get activeTable(): string | undefined {
        return this.activeTableName;
    }

    async profile(tableName?: string): Promise<DatasetProfile> {
        const table = tableName ?? this.activeTableName;
        if (!table) {
            throw new Error(
                "No table specified. Pass a fully qualified Unity Catalog table (catalog.schema.table).",
            );
        }
        this.activeTableName = table;

        const described = await this.sql(dialect.describeSql(table), { readOnly: true, maxRows: 500 });
        const describedColumns = parseDescribeTableRows(described.rows);
        if (describedColumns.length === 0) {
            throw new Error(
                `Could not describe "${table}". Check that the table exists and that you have USE/SELECT permissions.`,
            );
        }

        const aggregate = await this.sql(
            dialect.profileSql(describedColumns, table),
            { readOnly: true, maxRows: 1 },
        );
        const aggregateRow = aggregate.rows[0] ?? {};

        let sampleRows: Array<Record<string, unknown>> = [];
        try {
            const samples = await this.sql(
                `SELECT ${describedColumns.map((column) => dialect.quote(column.name)).join(", ")} ` +
                `FROM ${dialect.qualify(table)} LIMIT 5`,
                { readOnly: true, maxRows: 5 },
            );
            sampleRows = samples.rows;
        } catch {
            // Sampling can fail on restricted columns; profiles still work without it.
        }

        const rowCount = toNumber(aggregateRow.__row_count) ?? 0;
        const columns: ColumnProfile[] = describedColumns.map((column, index) => {
            const nonNull = toNumber(aggregateRow[`c${index}__non_null`]) ?? 0;
            const nullCount = Math.max(rowCount - nonNull, 0);
            const nullPct = rowCount > 0 ? Number(((nullCount / rowCount) * 100).toFixed(2)) : 0;

            const samples = new Set<unknown>();
            for (const row of sampleRows) {
                const value = row[column.name];
                if (value !== null && value !== undefined) samples.add(value);
                if (samples.size >= 5) break;
            }

            return {
                name: column.name,
                type: column.kind,
                nullCount,
                nullPct,
                distinctCount: toNumber(aggregateRow[`c${index}__distinct`]) ?? 0,
                sampleValues: [...samples],
                min: toScalar(aggregateRow[`c${index}__min`]),
                max: toScalar(aggregateRow[`c${index}__max`]),
                mean: toNumber(aggregateRow[`c${index}__mean`]),
                median: toNumber(aggregateRow[`c${index}__median`]),
            };
        });

        return {
            tableName: table,
            rowCount,
            columnCount: columns.length,
            columns,
        };
    }

    async query(sql: string, maxRows = 200): Promise<QueryResult> {
        assertReadOnlySql(sql);
        const result: SqlExecutionResult = await this.sql(sql, { readOnly: true, maxRows });
        return {
            columns: result.columns.map((column) => column.name),
            rows: result.rows.slice(0, maxRows),
            rowCount: result.rowCount,
            executionTimeMs: result.executionTimeMs,
        };
    }

    async calculateMetric(type: string, options: Record<string, unknown>): Promise<Record<string, unknown>> {
        const table = (options.tableName as string | undefined) ?? this.activeTableName;
        if (!table) {
            throw new Error("No table specified for metric calculation (catalog.schema.table).");
        }
        const qualified = dialect.qualify(table);

        if (type === "correlation") {
            const { colA, colB } = options as { colA?: string; colB?: string };
            if (!colA || !colB) throw new Error("Correlation requires colA and colB.");
            const a = dialect.quote(colA);
            const b = dialect.quote(colB);

            const result = await this.sql(
                `SELECT COUNT(*) AS n, ${dialect.correlation(a, b)} AS r ` +
                `FROM ${qualified} WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL`,
                { readOnly: true, maxRows: 1 },
            );
            const row = result.rows[0] ?? {};
            const n = toNumber(row.n) ?? 0;
            if (n <= 1) return { correlation: 0, sampleSize: n, note: "Sample size too small" };

            const r = toNumber(row.r) ?? 0;
            return {
                metric: "pearson_correlation",
                columns: [colA, colB],
                sampleSize: n,
                correlation: Number(r.toFixed(4)),
                strength: Math.abs(r) > 0.7 ? "strong" : Math.abs(r) > 0.4 ? "moderate" : "weak",
                direction: r > 0 ? "positive" : "negative",
            };
        }

        if (type === "percentiles") {
            const col = (options.col ?? options.colA) as string | undefined;
            if (!col) throw new Error("Percentiles require a column name.");
            const id = dialect.quote(col);
            const result = await this.sql(
                `SELECT COUNT(${id}) AS n, ` +
                `${dialect.percentile(id, 0.25)} AS p25, ` +
                `${dialect.percentile(id, 0.5)} AS p50, ` +
                `${dialect.percentile(id, 0.75)} AS p75, ` +
                `${dialect.percentile(id, 0.9)} AS p90, ` +
                `${dialect.percentile(id, 0.99)} AS p99 ` +
                `FROM ${qualified}`,
                { readOnly: true, maxRows: 1 },
            );
            const row = result.rows[0] ?? {};
            const count = toNumber(row.n) ?? 0;
            if (count === 0) return { error: "No numerical values found" };
            return {
                column: col,
                count,
                p25: toNumber(row.p25),
                p50_median: toNumber(row.p50),
                p75: toNumber(row.p75),
                p90: toNumber(row.p90),
                p99: toNumber(row.p99),
            };
        }

        throw new Error(`Unsupported metric type: ${type}`);
    }

    async listCatalogs(): Promise<string[]> {
        const result = await this.sql(dialect.listChildrenSql(), { readOnly: true, maxRows: 500 });
        return result.rows
            .map((row) => Object.values(row)[0])
            .filter((value): value is string => typeof value === "string");
    }

    async listSchemas(catalog: string): Promise<string[]> {
        const result = await this.sql(
            dialect.listChildrenSql({ namespace: [dialect.split(catalog)[0]!] }),
            { readOnly: true, maxRows: 500 },
        );
        return result.rows
            .map((row) => Object.values(row)[0])
            .filter((value): value is string => typeof value === "string");
    }

    async listTables(catalog: string, schema: string): Promise<Array<{ name: string; type?: string }>> {
        const result = await this.sql(
            dialect.listChildrenSql({ namespace: [dialect.split(catalog)[0]!, dialect.split(schema)[0]!] }),
            { readOnly: true, maxRows: 1000 },
        );
        return result.rows.flatMap((row) => {
            const name = row.tableName ?? row.table_name ?? row.name;
            if (typeof name !== "string") return [];
            const type = row.tableType ?? row.table_type ?? row.type;
            return [{ name, type: typeof type === "string" ? type : undefined }];
        });
    }

    async describeTable(table: string): Promise<DescribedColumn[]> {
        const result = await this.sql(
            dialect.describeSql(table),
            { readOnly: true, maxRows: 500 },
        );
        return parseDescribeTableRows(result.rows);
    }

    async close(): Promise<void> {
        await this.executor.close();
    }
}
