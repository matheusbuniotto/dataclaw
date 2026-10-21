#!/usr/bin/env bun
/**
 * Databricks-over-MCP demo.
 *
 * Uses the Databricks-managed SQL MCP server (/api/2.0/mcp/sql) to discover
 * Unity Catalog assets, profile a table, and run a read-only analytical query.
 *
 * Auth: DATABRICKS_HOST/DATABRICKS_TOKEN, or a logged-in Databricks CLI profile
 * (defaults to DEFAULT in ~/.databrickscfg).
 *
 * Usage:
 *   bun run demo:databricks
 *   bun run demo:databricks samples.nyctaxi.trips
 */
import { DatabricksDataAdapter } from "../src/adapters/databricks-adapter";

const table = process.argv[2] ?? "samples.nyctaxi.trips";

async function main() {
    const adapter = await DatabricksDataAdapter.connect({}, { defaultTable: table });
    try {
        console.log(`Connected to ${adapter.options.host} via MCP`);
        console.log(`Endpoint: ${adapter.options.mcpUrl}`);

        const catalogs = await adapter.listCatalogs();
        console.log(`\nVisible catalogs: ${catalogs.join(", ")}`);

        const [catalog, schema] = table.split(".");
        if (catalog && schema) {
            const tables = await adapter.listTables(catalog, schema);
            console.log(`\nTables in ${catalog}.${schema}: ${tables.map((entry) => entry.name).join(", ")}`);
        }

        console.log(`\nProfiling ${table}...`);
        const profile = await adapter.profile(table);
        console.log(`Rows: ${profile.rowCount} | Columns: ${profile.columnCount}`);
        for (const column of profile.columns) {
            console.log(
                `  - ${column.name} (${column.type}): nulls=${column.nullPct}%, distinct=${column.distinctCount}` +
                (column.mean !== undefined ? `, mean=${column.mean}` : ""),
            );
        }

        const textColumn = profile.columns.find((column) => column.type === "TEXT" && column.distinctCount > 1);
        const numericColumn = profile.columns.find((column) => column.type === "REAL" || column.type === "INTEGER");
        if (textColumn && numericColumn) {
            const sql =
                `SELECT \`${textColumn.name}\` AS segment, COUNT(*) AS n, ` +
                `ROUND(AVG(\`${numericColumn.name}\`), 2) AS avg_value ` +
                `FROM ${table} GROUP BY \`${textColumn.name}\` ORDER BY n DESC LIMIT 5`;
            console.log(`\nRunning: ${sql}`);
            const result = await adapter.query(sql, 5);
            console.table(result.rows);
        }
    } finally {
        await adapter.close();
    }
}

main().catch((err) => {
    console.error(`Databricks demo failed: ${err?.message ?? err}`);
    process.exitCode = 1;
});
