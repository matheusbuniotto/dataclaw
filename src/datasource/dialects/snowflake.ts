/**
 * Snowflake SQL: `SHOW` discovery, `DESCRIBE TABLE`, `PERCENTILE_CONT` and `CORR`, double-quoted
 * identifiers. Quoting is exact: an identifier is sent as written, so a lower-case name stays
 * lower-case, as Snowflake treats a quoted identifier.
 */
import { isReadOnlySql } from "../../mcp/mcp-sql-client";
import { quotePart, quoteQualifiedName, splitQuotedName } from "../identifiers";
import type { ColumnTraits, DatasetScope, DescribedColumn, Dialect } from "../types";
import { profileAggregateSql } from "./profile";

const QUOTE = '"';
const NUMBER = /^number(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/i;
const INTEGER_TYPES = /^(int|integer|bigint|smallint|tinyint|byteint)$/i;
const FLOAT_TYPES = /^(float|float4|float8|double|double precision|real|decimal|numeric)/i;
const TEMPORAL_TYPES = /^(date|datetime|time|timestamp|timestamp_ntz|timestamp_ltz|timestamp_tz)$/i;

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
    return `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${castDouble(expression)})`;
}

function correlation(a: string, b: string): string {
    return `CORR(${castDouble(a)}, ${castDouble(b)})`;
}

function classify(dataType: string): ColumnTraits {
    const number = NUMBER.exec(dataType);
    // NUMBER without a scale is an integer; NUMBER(10,2) is not.
    const numberInteger = number !== null && (number[2] === undefined || Number(number[2]) === 0);
    const integer = INTEGER_TYPES.test(dataType) || numberInteger;
    const real = FLOAT_TYPES.test(dataType) || (number !== null && !numberInteger);
    return {
        kind: integer ? "INTEGER" : real ? "REAL" : "TEXT",
        numeric: integer || real,
        temporal: TEMPORAL_TYPES.test(dataType),
    };
}

export const snowflakeDialect: Dialect = {
    id: "snowflake",
    quote,
    qualify,
    split: (dataset) => splitQuotedName(dataset, QUOTE),
    listChildrenSql(scope?: DatasetScope): string {
        const namespace = scope?.namespace ?? [];
        if (namespace.length === 0) return "SHOW DATABASES";
        if (namespace.length === 1) return `SHOW SCHEMAS IN DATABASE ${quote(namespace[0]!)}`;
        if (namespace.length === 2) {
            return `SHOW TABLES IN SCHEMA ${quote(namespace[0]!)}.${quote(namespace[1]!)}`;
        }
        throw new Error("A Snowflake namespace is database.schema; deeper parts belong to the table.");
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
