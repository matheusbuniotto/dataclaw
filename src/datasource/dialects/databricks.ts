/**
 * Databricks SQL: Unity Catalog discovery with `SHOW`, `DESCRIBE TABLE`, and the native aggregate
 * functions (`CORR`, `PERCENTILE_APPROX`). Backticked identifiers, catalog.schema.table.
 */
import { isReadOnlySql } from "../../mcp/mcp-sql-client";
import { quotePart, quoteQualifiedName, splitQuotedName } from "../identifiers";
import type { ColumnTraits, DatasetScope, DescribedColumn, Dialect } from "../types";
import { profileAggregateSql } from "./profile";

const QUOTE = "`";

const INTEGER_TYPES = /^(tinyint|smallint|int|integer|bigint|long|byte|short)$/i;
const FLOAT_TYPES = /^(float|double|real|decimal|numeric)/i;
const TEMPORAL_TYPES = /^(date|timestamp|timestamp_ntz|timestamp_ltz)$/i;

function quote(identifier: string): string {
    return quotePart(identifier, QUOTE);
}

function qualify(dataset: string): string {
    return quoteQualifiedName(dataset, QUOTE);
}

function castDouble(expression: string): string {
    return `CAST(${expression} AS DOUBLE)`;
}

function percentile(expression: string, p: number): string {
    return `PERCENTILE_APPROX(${castDouble(expression)}, ${p})`;
}

function correlation(a: string, b: string): string {
    return `CORR(${castDouble(a)}, ${castDouble(b)})`;
}

function classify(dataType: string): ColumnTraits {
    const integer = INTEGER_TYPES.test(dataType);
    const real = FLOAT_TYPES.test(dataType);
    return {
        kind: integer ? "INTEGER" : real ? "REAL" : "TEXT",
        numeric: integer || real,
        temporal: TEMPORAL_TYPES.test(dataType),
    };
}

export const databricksDialect: Dialect = {
    id: "databricks",
    quote,
    qualify,
    split: (dataset) => splitQuotedName(dataset, QUOTE),
    listChildrenSql(scope?: DatasetScope): string {
        const namespace = scope?.namespace ?? [];
        if (namespace.length === 0) return "SHOW CATALOGS";
        if (namespace.length === 1) return `SHOW SCHEMAS IN ${quote(namespace[0]!)}`;
        if (namespace.length === 2) {
            return `SHOW TABLES IN ${quote(namespace[0]!)}.${quote(namespace[1]!)}`;
        }
        throw new Error("A Databricks namespace is catalog.schema; deeper parts belong to the table.");
    },
    childKind: (scope?: DatasetScope) => (scope?.namespace ?? []).length >= 2 ? "dataset" : "namespace",
    describeSql: (dataset) => `DESCRIBE TABLE ${qualify(dataset)}`,
    sampleSql: (columns: readonly DescribedColumn[], dataset: string) =>
        `SELECT ${columns.map((column) => quote(column.name)).join(", ")} FROM ${qualify(dataset)} LIMIT 5`,
    profileSql: (columns: readonly DescribedColumn[], dataset: string) =>
        profileAggregateSql(columns, dataset, { quote, qualify, castDouble, percentile }),
    percentile,
    correlation,
    castDouble,
    classify,
    isReadOnly: isReadOnlySql,
};
