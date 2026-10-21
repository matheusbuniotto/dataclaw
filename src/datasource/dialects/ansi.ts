/**
 * The fallback dialect: ANSI-ish SQL over `INFORMATION_SCHEMA`, `"quoted"` identifiers, and
 * `PERCENTILE_CONT`. It fits most warehouses that publish the standard information schema; a
 * source whose discovery or percentile syntax differs gets its own dialect module instead of
 * bending this one.
 */
import { isReadOnlySql } from "../../mcp/mcp-sql-client";
import { quotePart, quoteQualifiedName, splitQuotedName } from "../identifiers";
import type { ColumnTraits, DatasetScope, DescribedColumn, Dialect } from "../types";
import { profileAggregateSql } from "./profile";

const QUOTE = '"';

const INTEGER_TYPES = /^(tinyint|smallint|int|integer|bigint|long|byte|short|number)$/i;
const FLOAT_TYPES = /^(float|double|real|decimal|numeric)/i;
const TEMPORAL_TYPES = /^(date|timestamp|timestamp with time zone|timestamp_ntz)$/i;

function quote(identifier: string): string {
    return quotePart(identifier, QUOTE);
}

function qualify(dataset: string): string {
    return quoteQualifiedName(dataset, QUOTE);
}

/** A string literal for `INFORMATION_SCHEMA` filters. Doubling `'` is the whole rule. */
function literal(value: string): string {
    return `'${value.split("'").join("''")}'`;
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
    const integer = INTEGER_TYPES.test(dataType);
    const real = FLOAT_TYPES.test(dataType);
    return {
        kind: integer ? "INTEGER" : real ? "REAL" : "TEXT",
        numeric: integer || real,
        temporal: TEMPORAL_TYPES.test(dataType),
    };
}

/** Split `table.name` into [catalog?, schema?, table]. The last part is the table. */
function describeTarget(dataset: string): { catalog?: string; schema?: string; table: string } {
    const parts = splitQuotedName(dataset, QUOTE);
    const table = parts[parts.length - 1]!;
    const rest = parts.slice(0, -1);
    if (rest.length > 2) throw new Error(`"${dataset}" has more namespace parts than catalog.schema.table.`);
    return {
        ...(rest.length === 2 ? { catalog: rest[0]!, schema: rest[1]! } : {}),
        ...(rest.length === 1 ? { schema: rest[0]! } : {}),
        table,
    };
}

export const ansiDialect: Dialect = {
    id: "ansi",
    quote,
    qualify,
    split: (dataset) => splitQuotedName(dataset, QUOTE),
    listChildrenSql(scope?: DatasetScope): string {
        const namespace = scope?.namespace ?? [];
        if (namespace.length === 0) {
            return "SELECT DISTINCT catalog_name FROM information_schema.schemata ORDER BY catalog_name";
        }
        if (namespace.length === 1) {
            return "SELECT schema_name FROM information_schema.schemata " +
                `WHERE catalog_name = ${literal(namespace[0]!)} ORDER BY schema_name`;
        }
        if (namespace.length === 2) {
            return "SELECT table_name, table_type FROM information_schema.tables " +
                `WHERE table_catalog = ${literal(namespace[0]!)} ` +
                `AND table_schema = ${literal(namespace[1]!)} ORDER BY table_name`;
        }
        throw new Error("An ANSI namespace is catalog.schema; deeper parts belong to the table.");
    },
    describeSql(dataset: string): string {
        const target = describeTarget(dataset);
        const conditions = [`table_name = ${literal(target.table)}`];
        if (target.schema) conditions.push(`table_schema = ${literal(target.schema)}`);
        if (target.catalog) conditions.push(`table_catalog = ${literal(target.catalog)}`);
        return "SELECT column_name, data_type FROM information_schema.columns " +
            `WHERE ${conditions.join(" AND ")} ORDER BY ordinal_position`;
    },
    profileSql: (columns: readonly DescribedColumn[], dataset: string) =>
        profileAggregateSql(columns, dataset, { quote, qualify, castDouble, percentile }),
    percentile,
    correlation,
    castDouble,
    classify,
    isReadOnly: isReadOnlySql,
};
