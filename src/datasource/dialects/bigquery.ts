/**
 * BigQuery SQL: `INFORMATION_SCHEMA` discovery, backticked `project.dataset.table`, `CORR`, and
 * `APPROX_QUANTILES` for percentiles. `region-us` is the qualifier the information schema needs
 * before a project is known; discovery narrows to the project once one is named.
 */
import { isReadOnlySql } from "../../mcp/mcp-sql-client";
import { quotePart, splitQuotedName } from "../identifiers";
import type { ColumnTraits, DatasetScope, DescribedColumn, Dialect } from "../types";
import { profileAggregateSql } from "./profile";

const QUOTE = "`";
const INTEGER_TYPES = /^(int64|integer|int|smallint|tinyint|byteint)$/i;
const FLOAT_TYPES = /^(float64|float|numeric|bignumeric|decimal)/i;
const TEMPORAL_TYPES = /^(date|datetime|time|timestamp)$/i;

function quote(identifier: string): string {
    return quotePart(identifier, QUOTE);
}

function qualify(dataset: string): string {
    return splitQuotedName(dataset, QUOTE).map(quote).join(".");
}

function literal(value: string): string {
    return `'${value.split("'").join("''")}'`;
}

function castDouble(expression: string): string {
    return `CAST(${expression} AS FLOAT64)`;
}

/** BigQuery has no exact percentile aggregate; the offset form is the documented one. */
function percentile(expression: string, p: number): string {
    return `APPROX_QUANTILES(${castDouble(expression)}, 100)[OFFSET(${Math.round(p * 100)})]`;
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

/** Split `project.dataset.table`; the last part is the table. */
function target(dataset: string): { project?: string; schema?: string; table: string } {
    const parts = splitQuotedName(dataset, QUOTE);
    const table = parts[parts.length - 1]!;
    const rest = parts.slice(0, -1);
    if (rest.length > 2) throw new Error(`"${dataset}" has more namespace parts than project.dataset.table.`);
    return {
        ...(rest.length === 2 ? { project: rest[0]!, schema: rest[1]! } : {}),
        ...(rest.length === 1 ? { schema: rest[0]! } : {}),
        table,
    };
}

export const bigqueryDialect: Dialect = {
    id: "bigquery",
    quote,
    qualify,
    split: (dataset) => splitQuotedName(dataset, QUOTE),
    listChildrenSql(scope?: DatasetScope): string {
        const namespace = scope?.namespace ?? [];
        if (namespace.length === 0) {
            return "SELECT DISTINCT table_catalog AS name FROM `region-us`.INFORMATION_SCHEMA.TABLES ORDER BY name";
        }
        if (namespace.length === 1) {
            return `SELECT schema_name AS name FROM ${quote(namespace[0]!)}.INFORMATION_SCHEMA.SCHEMATA ORDER BY name`;
        }
        if (namespace.length === 2) {
            return "SELECT table_name AS name, table_type FROM " +
                `${quote(namespace[0]!)}.INFORMATION_SCHEMA.TABLES ` +
                `WHERE table_schema = ${literal(namespace[1]!)} ORDER BY name`;
        }
        throw new Error("A BigQuery namespace is project.dataset; deeper parts belong to the table.");
    },
    childKind: (scope?: DatasetScope) => (scope?.namespace ?? []).length >= 2 ? "dataset" : "namespace",
    describeSql(dataset: string): string {
        const found = target(dataset);
        if (!found.project) throw new Error("A BigQuery dataset needs project.dataset.table.");
        const conditions = [`table_name = ${literal(found.table)}`];
        if (found.schema) conditions.push(`table_schema = ${literal(found.schema)}`);
        return "SELECT column_name, data_type FROM " +
            `${quote(found.project)}.INFORMATION_SCHEMA.COLUMNS ` +
            `WHERE ${conditions.join(" AND ")} ORDER BY ordinal_position`;
    },
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
