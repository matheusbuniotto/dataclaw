/**
 * The dialects that exist. A manifest may name any dialect in `DIALECT_NAMES`; asking for one
 * without a module fails closed with `dialect-missing`, naming the file to add.
 */
import type { DialectName } from "../../plugins/types";
import { SourceError, type Dialect } from "../types";
import { ansiDialect } from "./ansi";
import { bigqueryDialect } from "./bigquery";
import { databricksDialect } from "./databricks";
import { snowflakeDialect } from "./snowflake";

const INSTALLED: Partial<Record<DialectName, Dialect>> = {
    ansi: ansiDialect,
    databricks: databricksDialect,
    snowflake: snowflakeDialect,
    bigquery: bigqueryDialect,
};

export function dialectFor(name: DialectName): Dialect {
    const dialect = INSTALLED[name];
    if (!dialect) {
        throw new SourceError("dialect-missing", `No SQL dialect is installed for "${name}".`, {
            hint: `Add src/datasource/dialects/${name}.ts and register it in dialects/index.ts.`,
        });
    }
    return dialect;
}

export function installedDialects(): DialectName[] {
    return Object.keys(INSTALLED) as DialectName[];
}

export { ansiDialect, bigqueryDialect, databricksDialect, snowflakeDialect };
