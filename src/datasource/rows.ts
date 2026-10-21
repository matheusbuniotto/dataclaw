/**
 * Reading MCP result rows back into DataClaw's shapes.
 *
 * A provider may answer `describe` and `inventory` itself; when it does not, the session runs the
 * dialect's SQL and reads the rows here. Both paths meet these functions, so a source with and a
 * source without native tools produce the same columns.
 */
import type { ColumnProfile, DatasetProfile } from "../adapters/adapter-interface";
import type { ColumnTraits, DescribedColumn, Discovery } from "./types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
    const named = pickString(row, keys);
    if (named) return named;
    const anyString = Object.values(row).find((value): value is string => typeof value === "string" && value.trim() !== "");
    return anyString?.trim();
}

/** Parse `DESCRIBE TABLE` or `INFORMATION_SCHEMA.COLUMNS` rows into described columns. */
export function parseDescribedColumns(
    rows: readonly unknown[],
    classify: (dataType: string) => ColumnTraits,
): DescribedColumn[] {
    const columns: DescribedColumn[] = [];
    for (const value of rows) {
        const row = asRecord(value);
        if (!row) continue;
        const name = firstString(row, ["column_name", "col_name", "COL_NAME", "COLUMN_NAME", "name", "Name"]);
        if (!name || name.startsWith("#")) continue;
        const dataType = firstString(row, ["data_type", "DATA_TYPE", "type", "Type"]) ?? "STRING";
        columns.push({ name, dataType, ...classify(dataType) });
    }
    return columns;
}

/** Rows from `SHOW ...` or `INFORMATION_SCHEMA` into discovery entries. */
export function discoveryFromRows(rows: readonly unknown[], kind: Discovery["kind"]): Discovery[] {
    const seen = new Set<string>();
    const found: Discovery[] = [];
    for (const value of rows) {
        const row = asRecord(value);
        if (!row) continue;
        const name = firstString(row, ["name", "table_name", "tableName", "tab_name", "column_name", "catalog_name", "schema_name"]);
        if (!name || seen.has(name)) continue;
        const detail = pickString(row, ["type", "table_type", "tableType", "data_type"]);
        seen.add(name);
        found.push({ name, kind, ...(detail ? { detail } : {}) });
    }
    return found;
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
 * Compose a `DatasetProfile` from the aggregate row the dialect's `profileSql` returned.
 * The aliases are the dialect contract: `__row_count` and `c{i}__*`.
 */
export function profileFromAggregate(
    columns: readonly DescribedColumn[],
    row: Record<string, unknown>,
    dataset: string,
): DatasetProfile {
    const rowCount = toNumber(row.__row_count) ?? 0;

    const profiled: ColumnProfile[] = columns.map((column, index) => {
        const nonNull = toNumber(row[`c${index}__non_null`]) ?? 0;
        const nullCount = Math.max(rowCount - nonNull, 0);
        const min = toScalar(row[`c${index}__min`]);
        const max = toScalar(row[`c${index}__max`]);
        const mean = toNumber(row[`c${index}__mean`]);
        const median = toNumber(row[`c${index}__median`]);
        return {
            name: column.name,
            type: column.kind,
            nullCount,
            nullPct: rowCount > 0 ? Number(((nullCount / rowCount) * 100).toFixed(2)) : 0,
            distinctCount: toNumber(row[`c${index}__distinct`]) ?? 0,
            sampleValues: [],
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
            ...(mean !== undefined ? { mean } : {}),
            ...(median !== undefined ? { median } : {}),
        };
    });

    return {
        tableName: dataset,
        rowCount,
        columnCount: profiled.length,
        columns: profiled,
    };
}

/** Fill `sampleValues` from sampled rows, keeping the first distinct non-null values per column. */
export function applySamples(profile: DatasetProfile, rows: readonly unknown[]): void {
    for (const column of profile.columns) {
        const values = new Set<unknown>();
        for (const value of rows) {
            const row = asRecord(value);
            if (!row) continue;
            const cell = row[column.name];
            if (cell !== null && cell !== undefined) values.add(cell);
            if (values.size >= 5) break;
        }
        column.sampleValues = [...values];
    }
}
