/**
 * A data source declared by a manifest: any MCP server that publishes a query tool, optionally a
 * describe, inventory or profile tool.
 *
 * What the server returns is decoded here, fail-closed: a shape DataClaw does not understand is a
 * `query-error` naming the shape the manifest should have mapped, never a guessed table.
 */
import type { McpToolClient } from "../../plugins/transports";
import type { DataSourceManifest, LoadedPlugin } from "../../plugins/types";
import type { ColumnProfile, DatasetProfile, QueryResult } from "../../adapters/adapter-interface";
import { discoveryFromRows, parseDescribedColumns } from "../rows";
import {
    SourceError,
    type ColumnKind,
    type DataProvider,
    type DatasetScope,
    type DescribedColumn,
    type Dialect,
    type Discovery,
} from "../types";
import { translateProviderError } from "./errors";

/** Argument names a tool is called with, unless the manifest overrides them. */
export const DEFAULT_ARGUMENTS = {
    query: "sql",
    describe: "table",
    inventory: "namespace",
    profile: "table",
} as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function columnNames(columns: unknown): string[] {
    if (!Array.isArray(columns)) return [];
    return columns.flatMap((column) => {
        if (typeof column === "string") return [column];
        const record = asRecord(column);
        return record && typeof record.name === "string" ? [record.name] : [];
    });
}

function recordsFrom(rows: unknown, columns: readonly string[]): Array<Record<string, unknown>> {
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
        if (Array.isArray(row)) {
            return [Object.fromEntries(columns.map((name, index) => [name, row[index]]))];
        }
        const record = asRecord(row);
        return record ? [record] : [];
    });
}

/**
 * Decode a query tool's result. Accepted shapes: an object with `columns` (names or `{name}`) and
 * `rows` (records or positional arrays), or a bare array of records.
 */
export function queryResultFromValue(value: unknown, provider: string, executionTimeMs = 0): QueryResult {
    const record = asRecord(value);
    if (!record) {
        if (Array.isArray(value)) {
            const rows = value.flatMap((row) => {
                const found = asRecord(row);
                return found ? [found] : [];
            });
            const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
            return { columns, rows, rowCount: rows.length, executionTimeMs };
        }
        throw new SourceError("query-error", `the ${provider} query tool returned no table`, {
            provider,
            hint: "The query tool must return { columns, rows }.",
        });
    }

    const columns = columnNames(record.columns);
    const rows = recordsFrom(record.rows, columns);
    const declared = Number(record.rowCount ?? record.row_count ?? rows.length);
    if (columns.length === 0 && rows.length === 0) {
        throw new SourceError("query-error", `the ${provider} query tool returned no table shape`, {
            provider,
            hint: "Return { columns, rows } from the query tool.",
        });
    }

    return {
        columns: columns.length > 0 ? columns : Object.keys(rows[0] ?? {}),
        rows,
        rowCount: Number.isFinite(declared) ? declared : rows.length,
        executionTimeMs,
    };
}

/** Decode a profile tool's result. Anything less than the documented shape is an error. */
export function datasetProfileFromValue(value: unknown, dataset: string, provider: string): DatasetProfile {
    const record = asRecord(value);
    const rawColumns = Array.isArray(record?.columns) ? record.columns : undefined;
    const failure = (why: string): never => {
        throw new SourceError("query-error", `the ${provider} profile tool ${why}`, {
            provider,
            hint: "Omit dataSource.tools.profile and let the dialect profile the table instead.",
        });
    };
    if (!record || !rawColumns) failure("did not return { rowCount, columns }");

    const kind = (type: unknown): ColumnKind =>
        type === "INTEGER" || type === "REAL" || type === "TEXT" ? type : "TEXT";

    const columns: ColumnProfile[] = rawColumns!.flatMap((raw) => {
        const column = asRecord(raw);
        if (!column || typeof column.name !== "string") return [];
        const min = column.min;
        const max = column.max;
        return [{
            name: column.name,
            type: kind(column.type),
            nullCount: Number(column.nullCount ?? 0),
            nullPct: Number(column.nullPct ?? 0),
            distinctCount: Number(column.distinctCount ?? 0),
            sampleValues: Array.isArray(column.sampleValues) ? column.sampleValues : [],
            ...(typeof min === "number" || typeof min === "string" ? { min } : {}),
            ...(typeof max === "number" || typeof max === "string" ? { max } : {}),
            ...(typeof column.mean === "number" ? { mean: column.mean } : {}),
            ...(typeof column.median === "number" ? { median: column.median } : {}),
        }];
    });
    if (columns.length === 0) failure("returned no usable columns");

    return {
        tableName: dataset,
        rowCount: Number(record!.rowCount ?? record!.row_count ?? 0),
        columnCount: columns.length,
        columns,
    };
}

/**
 * Check the manifest's declared tools against what the server actually publishes. A missing tool
 * fails with the real list, so a provider author sees the typo instead of a wrong binding.
 */
export function verifyProviderTools(
    spec: DataSourceManifest,
    listed: readonly string[],
    provider: string,
): void {
    const declared: Array<[string, string]> = [
        ["query", spec.tools.query],
        ...(spec.tools.describe ? [["describe", spec.tools.describe] as [string, string]] : []),
        ...(spec.tools.profile ? [["profile", spec.tools.profile] as [string, string]] : []),
        ...(spec.tools.inventory ? [["inventory", spec.tools.inventory] as [string, string]] : []),
    ];
    const missing = declared.filter(([, tool]) => !listed.includes(tool));
    if (missing.length > 0) {
        throw new SourceError(
            "unsupported-capability",
            `the ${provider} server does not publish ${missing.map(([role, tool]) => `${role} tool "${tool}"`).join(", ")}.`,
            {
                provider,
                available: listed,
                hint: "Fix dataSource.tools in the manifest, or drop the entry to use the dialect.",
            },
        );
    }

    if (spec.readOnly.mode === "tool") {
        const readOnlyTool = spec.readOnly.tool ?? spec.tools.query;
        if (!listed.includes(readOnlyTool)) {
            throw new SourceError(
                "read-only-unavailable",
                `the ${provider} server publishes no read-only tool "${readOnlyTool}".`,
                {
                    provider,
                    available: listed,
                    hint: "Point dataSource.readOnly.tool at the server's read-only tool.",
                },
            );
        }
    }
}

export function manifestProvider(
    plugin: LoadedPlugin,
    transport: McpToolClient,
    dialect: Dialect,
): DataProvider {
    const spec = plugin.manifest.dataSource;
    if (!spec) throw new Error(`plugin ${plugin.manifest.name} has no dataSource block`);

    const provider = plugin.manifest.name;
    const args = { ...DEFAULT_ARGUMENTS, ...(spec.arguments ?? {}) };
    const queryTool = spec.readOnly.mode === "tool"
        ? spec.readOnly.tool ?? spec.tools.query
        : spec.tools.query;
    const describeTool = spec.tools.describe;
    const inventoryTool = spec.tools.inventory;
    const profileTool = spec.tools.profile;

    const call = async (tool: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
        try {
            return await transport.callTool(tool, input, { ...(signal ? { signal } : {}) });
        } catch (err) {
            throw translateProviderError(err, provider);
        }
    };

    const source: DataProvider = {
        id: provider,
        kind: "remote",
        dialect,

        async probe() {
            let listed: string[];
            try {
                listed = await transport.listTools();
            } catch (err) {
                throw translateProviderError(err, provider);
            }
            verifyProviderTools(spec, listed, provider);
            return { tools: listed, readOnly: spec.readOnly.mode };
        },

        async execute(sql: string, executeOptions = {}) {
            if (!dialect.isReadOnly(sql)) {
                throw new SourceError("read-only-violation", "Only read-only SQL is permitted.", {
                    provider,
                    hint: "Rephrase the statement as a query; mutations are blocked for safety.",
                });
            }
            if (executeOptions.signal?.aborted) {
                throw new SourceError("aborted", "Stopped.", { provider });
            }

            const input: Record<string, unknown> = { [args.query]: sql };
            if (spec.readOnly.mode === "tool" && spec.readOnly.argument) {
                input[spec.readOnly.argument] = spec.readOnly.value;
            }

            const started = Date.now();
            const value = await call(queryTool, input, executeOptions.signal);
            const result = queryResultFromValue(value, provider, Date.now() - started);
            return executeOptions.maxRows !== undefined
                ? { ...result, rows: result.rows.slice(0, executeOptions.maxRows) }
                : result;
        },

        async close() {
            await transport.close();
        },

        ...(describeTool
            ? {
                async describe(dataset: string, signal?: AbortSignal): Promise<DescribedColumn[]> {
                    const value = await call(describeTool, { [args.describe]: dataset }, signal);
                    return parseDescribedColumns(queryResultFromValue(value, provider).rows, dialect.classify);
                },
            }
            : {}),

        ...(inventoryTool
            ? {
                async inventory(scope: DatasetScope | undefined, signal?: AbortSignal): Promise<Discovery[]> {
                    const value = await call(
                        inventoryTool,
                        { [args.inventory]: scope?.namespace ?? [] },
                        signal,
                    );
                    return discoveryFromRows(queryResultFromValue(value, provider).rows, dialect.childKind(scope));
                },
            }
            : {}),

        ...(profileTool
            ? {
                async profile(dataset: string, signal?: AbortSignal) {
                    const value = await call(profileTool, { [args.profile]: dataset }, signal);
                    return datasetProfileFromValue(value, dataset, provider);
                },
            }
            : {}),
    };

    return source;
}
