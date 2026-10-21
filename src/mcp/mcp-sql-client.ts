import type { DatabricksMcpConfig } from "./databricks-config";
import { HttpMcpClient, sleep, throwIfStopped } from "./http-mcp-client";

export { isStoppedError, stoppedError } from "./http-mcp-client";

export interface SqlColumn {
    name: string;
    type: string;
}

export interface SqlExecutionResult {
    columns: SqlColumn[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    truncated: boolean;
    statementId?: string;
    state?: string;
    executionTimeMs: number;
}

export interface ExecuteSqlOptions {
    readOnly?: boolean;
    maxRows?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
    /** Cancels the in-flight MCP call and the poll loop. */
    signal?: AbortSignal;
}

export interface McpClientOptions {
    clientName?: string;
    clientVersion?: string;
    /** Re-mints the bearer token; used to reconnect after a 401/403. `force` asks for a fresh token. */
    tokenFactory?: (force?: boolean) => string | Promise<string>;
}

/** Small seam so the adapter can be tested without a live MCP connection. */
export interface SqlExecutor {
    execute(sql: string, options?: ExecuteSqlOptions): Promise<SqlExecutionResult>;
    close(): Promise<void>;
}

interface NormalizedStatement {
    columns: SqlColumn[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    truncated: boolean;
    statementId?: string;
    state?: string;
}

const PENDING_STATES = new Set(["PENDING", "RUNNING", "QUEUED", "IN_PROGRESS"]);
const FAILED_STATES = new Set(["FAILED", "CANCELED", "CANCELLED", "CLOSED"]);

const INTEGER_TYPES = /^(tinyint|smallint|int|integer|bigint|long|byte|short)$/i;
const FLOAT_TYPES = /^(float|double|real|decimal|numeric)/i;

/** Keywords that make a statement non read-only. Checked outside string literals. */
const MUTATING_KEYWORDS = new RegExp(
    "\\b(" +
    [
        "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE",
        "OVERWRITE", "GRANT", "REVOKE", "COPY", "OPTIMIZE", "VACUUM", "RESTORE",
    ].join("|") +
    ")\\b",
    "i",
);

/** Remove string literals / quoted identifiers so keyword scans ignore them. */
function stripQuoted(sql: string): string {
    return sql
        .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
        .replace(/`(?:[^`]|``)*`/g, "``")
        .replace(/"([^"]|"")*"/g, '""');
}

/**
 * True when the statement only reads data. Conservative on purpose: analytical
 * agents must never mutate a shared warehouse through this adapter.
 */
export function isReadOnlySql(sql: string): boolean {
    const withoutComments = sql
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/--[^\n]*/g, " ")
        .trim();
    if (!withoutComments) return false;

    const unquoted = stripQuoted(withoutComments);
    if (/;\s*\S/.test(unquoted)) return false; // multiple statements

    const first = unquoted.match(/^\(*\s*([a-zA-Z]+)/)?.[1]?.toUpperCase();
    // A CTE can be followed by DML (`WITH x AS (...) INSERT ...`), so scan it.
    if (first === "WITH") return !MUTATING_KEYWORDS.test(unquoted);
    return first === "SELECT" || first === "SHOW" || first === "DESCRIBE" ||
        first === "DESC" || first === "EXPLAIN";
}

export function assertReadOnlySql(sql: string): void {
    if (!isReadOnlySql(sql)) {
        throw new Error(
            "Only read-only SQL is permitted (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN). " +
            "Mutating statements are blocked for safety.",
        );
    }
}

export function quoteIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, "``")}\``;
}

/**
 * Split `catalog.schema.table` honoring backticked parts (e.g. `my-catalog`.`my.schema`.t).
 * Rejects empty parts and control characters.
 */
export function splitQualifiedName(name: string): string[] {
    const input = name.trim();
    if (!input) throw new Error("Identifier must not be empty.");

    const parts: string[] = [];
    let current = "";
    let inBacktick = false;

    for (const char of input) {
        if (char === "`") {
            inBacktick = !inBacktick;
            current += char;
            continue;
        }
        if (char === "." && !inBacktick) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    parts.push(current);

    if (inBacktick) throw new Error(`Unbalanced backticks in identifier: ${name}`);

    return parts.map((part) => {
        const trimmed = part.trim();
        if (!trimmed) throw new Error(`Invalid qualified name "${name}": empty part.`);
        const unquoted = trimmed.startsWith("`") && trimmed.endsWith("`")
            ? trimmed.slice(1, -1).replace(/``/g, "`")
            : trimmed;
        if (!unquoted || /[`\u0000-\u001f;]/.test(unquoted)) {
            throw new Error(`Invalid identifier part "${part}" in "${name}".`);
        }
        return unquoted;
    });
}

export function quoteQualifiedName(name: string): string {
    return splitQualifiedName(name).map(quoteIdentifier).join(".");
}

function toNumberIfSafe(value: string): number | string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    if (Number.isSafeInteger(parsed) || !/^-?\d+$/.test(value)) return parsed;
    return value;
}

/**
 * Decode one Databricks SQL result value.
 *
 * The statement API emits both the classic JSON form
 * (`{"string_value": "...", "long_value": "42"}`) and the typed PROTOBUF form
 * (`{"str": "...", "i64": "42", "f64": 1.5, "null": true}`). Both are handled.
 */
export function decodeSqlValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(decodeSqlValue);

    const raw = value as Record<string, unknown>;
    if (raw.null === true || raw.is_null === true) return null;

    if ("string_value" in raw) return raw.string_value;
    if ("str" in raw) return raw.str;
    if ("long_value" in raw) return toNumberIfSafe(String(raw.long_value));
    if ("i64" in raw) return toNumberIfSafe(String(raw.i64));
    if ("double_value" in raw) return Number(raw.double_value);
    if ("f64" in raw) return Number(raw.f64);
    if ("boolean_value" in raw) return Boolean(raw.boolean_value);
    if ("bool" in raw) return Boolean(raw.bool);
    if ("decimal_value" in raw) return raw.decimal_value;
    if ("decimal" in raw) return raw.decimal;
    if ("date_value" in raw) return raw.date_value;
    if ("date" in raw) return raw.date;
    if ("timestamp_value" in raw) return raw.timestamp_value;
    if ("timestamp" in raw) return raw.timestamp;
    if ("binary_value" in raw) return raw.binary_value;
    if ("binary" in raw) return raw.binary;
    if ("array_value" in raw) return decodeSqlValue(raw.array_value);
    if ("array" in raw) return decodeSqlValue(raw.array);
    if ("struct_value" in raw) return decodeSqlValue(raw.struct_value);
    if ("struct" in raw) return decodeSqlValue(raw.struct);
    if ("map_value" in raw) return decodeSqlValue(raw.map_value);
    if ("map" in raw) return decodeSqlValue(raw.map);
    if ("variant_value" in raw) return raw.variant_value;
    if ("variant" in raw) return raw.variant;

    return raw;
}

function coerceByType(value: unknown, typeName: string | undefined): unknown {
    if (value === null || value === undefined || !typeName) return value;
    if (typeof value === "string") {
        if (INTEGER_TYPES.test(typeName) || FLOAT_TYPES.test(typeName)) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : value;
        }
        if (/^boolean$/i.test(typeName)) {
            if (value.toLowerCase() === "true") return true;
            if (value.toLowerCase() === "false") return false;
        }
    }
    return value;
}

function extractRows(payload: any): Array<{ values: unknown[] }> {
    const arrays = [
        payload?.result?.data_array,
        payload?.result?.data_typed_array,
        payload?.data_array,
        payload?.data_typed_array,
    ];
    for (const candidate of arrays) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

/** Convert a Databricks `execute_sql` / `poll_sql_result` payload into tabular rows. */
export function normalizeStatementResult(payload: any): NormalizedStatement {
    const schemaColumns: any[] = payload?.manifest?.schema?.columns ?? [];
    const columns: SqlColumn[] = schemaColumns.map((col: any, index: number) => ({
        name: String(col?.name ?? `col_${index}`),
        type: String(col?.type_name ?? col?.type_text ?? "STRING"),
    }));

    const rawRows = extractRows(payload);
    const rows = rawRows.map((row) => {
        const values = Array.isArray(row?.values) ? row.values : Array.isArray(row) ? row : [];
        const record: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
            const column = columns[i]!;
            record[column.name] = coerceByType(decodeSqlValue(values[i]), column.type);
        }
        return record;
    });

    const totalRows = Number(payload?.manifest?.total_row_count ?? payload?.total_row_count ?? rows.length);
    const totalChunks = Number(payload?.manifest?.total_chunk_count ?? 1);
    const truncated = Boolean(
        payload?.truncated ||
        payload?.manifest?.truncated ||
        (Number.isFinite(totalChunks) && totalChunks > 1) ||
        (Number.isFinite(totalRows) && totalRows > rows.length),
    );

    return {
        columns,
        rows,
        rowCount: Number.isFinite(totalRows) ? totalRows : rows.length,
        truncated,
        statementId: payload?.statement_id,
        state: payload?.status?.state,
    };
}

function unwrapToolResult(result: any): any {
    if (result?.structuredContent && typeof result.structuredContent === "object") {
        return result.structuredContent;
    }
    const text = Array.isArray(result?.content)
        ? result.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("")
        : undefined;
    if (typeof text === "string" && text.trim()) {
        try {
            return JSON.parse(text);
        } catch {
            return { message: text };
        }
    }
    return result;
}

/**
 * MCP client for the Databricks-managed SQL MCP server.
 *
 * Speaks streamable HTTP JSON-RPC to `/api/2.0/mcp/sql`, uses the read-only
 * execution tool by default, and polls long-running statements to completion.
 */
/**
 * SQL over an MCP server: choose the read-only execution tool, poll a long-running statement,
 * and decode the typed result. The wire itself lives in `HttpMcpClient`.
 */
export class McpSqlClient implements SqlExecutor {
    private constructor(
        private readonly http: HttpMcpClient,
        private readonly config: DatabricksMcpConfig,
    ) { }

    static async connect(
        config: DatabricksMcpConfig,
        options: McpClientOptions = {},
    ): Promise<McpSqlClient> {
        const http = await HttpMcpClient.connect({
            url: config.url,
            tokenProvider: options.tokenFactory ?? (() => config.token),
            timeoutMs: config.timeoutMs,
            ...(options.clientName ? { clientName: options.clientName } : {}),
            ...(options.clientVersion ? { clientVersion: options.clientVersion } : {}),
        });
        return new McpSqlClient(http, config);
    }

    get availableTools(): string[] {
        return this.http.availableTools;
    }

    private async callTool(
        name: string,
        args: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<any> {
        const result = await this.http.callTool(name, args, { ...(signal ? { signal } : {}) });
        if (result.isError) {
            const payload = unwrapToolResult(result);
            const message = payload?.message ?? payload?.error ?? JSON.stringify(payload);
            throw new Error(`Databricks MCP tool ${name} returned an error: ${message}`);
        }
        return unwrapToolResult(result);
    }

    async execute(sql: string, options: ExecuteSqlOptions = {}): Promise<SqlExecutionResult> {
        const started = performance.now();
        const readOnly = options.readOnly ?? this.config.readOnly;
        if (readOnly) assertReadOnlySql(sql);

        const toolName = readOnly && this.availableTools.includes("execute_sql_read_only")
            ? "execute_sql_read_only"
            : "execute_sql";

        const signal = options.signal;
        let payload = await this.callTool(toolName, { query: sql }, signal);
        const statementId: string | undefined = payload?.statement_id;
        let state: string | undefined = payload?.status?.state;

        const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
        const deadline = Date.now() + timeoutMs;
        let interval = options.pollIntervalMs ?? 250;

        while (PENDING_STATES.has(String(state).toUpperCase())) {
            throwIfStopped(signal);
            if (!statementId || !this.availableTools.includes("poll_sql_result")) {
                throw new Error(
                    `SQL statement ${statementId ?? "(unknown)"} is still ${state}, but this MCP server cannot poll results.`,
                );
            }
            if (Date.now() > deadline) {
                throw new Error(
                    `SQL statement ${statementId} did not finish within ${timeoutMs}ms (last state: ${state}).`,
                );
            }
            await sleep(interval, signal);
            interval = Math.min(Math.round(interval * 1.6), 2_000);
            payload = await this.callTool("poll_sql_result", { statement_id: statementId }, signal);
            state = payload?.status?.state;
        }

        if (FAILED_STATES.has(String(state).toUpperCase())) {
            const detail = payload?.status?.error?.message ?? payload?.message ?? `statement ${state}`;
            throw new Error(`Databricks SQL execution failed: ${detail}`);
        }

        const normalized = normalizeStatementResult(payload);
        const maxRows = options.maxRows;
        const rows = typeof maxRows === "number" ? normalized.rows.slice(0, maxRows) : normalized.rows;

        return {
            ...normalized,
            rows,
            rowCount: normalized.rowCount,
            truncated: normalized.truncated || rows.length < normalized.rows.length,
            executionTimeMs: Number((performance.now() - started).toFixed(2)),
        };
    }

    async close(): Promise<void> {
        await this.http.close();
    }
}
