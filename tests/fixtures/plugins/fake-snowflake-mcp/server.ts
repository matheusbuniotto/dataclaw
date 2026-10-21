/**
 * Test-only data MCP server that behaves like a Snowflake warehouse over stdio.
 *
 * It exists to prove one claim: a new data source is a manifest plus a server, with no change under
 * `src/datasource/`. The manifest names the dialect, the three tools, and the read-only argument;
 * this file answers them with a fixed two-column table.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const COLUMNS = [
    { column_name: "ID", data_type: "NUMBER(38,0)" },
    { column_name: "AMOUNT", data_type: "NUMBER(10,2)" },
];

const ROWS = [
    { ID: 1, AMOUNT: 10 },
    { ID: 2, AMOUNT: 20 },
    { ID: 3, AMOUNT: null },
];

function table(columns: string[], rows: Array<Record<string, unknown>>): unknown {
    return { columns, rows, rowCount: rows.length };
}

function runSql(statement: string): unknown {
    const sql = statement.toUpperCase();

    if (sql.includes("SHOW DATABASES")) return table(["name"], [{ name: "ANALYTICS" }]);
    if (sql.includes("SHOW SCHEMAS IN DATABASE")) return table(["name"], [{ name: "PUBLIC" }]);
    if (sql.includes("SHOW TABLES IN SCHEMA")) return table(["name", "table_type"], [{ name: "ORDERS", table_type: "TABLE" }]);
    if (sql.startsWith("DESCRIBE TABLE")) return table(["column_name", "data_type"], COLUMNS);

    if (sql.includes("__ROW_COUNT")) {
        return table([], [{
            __row_count: 3,
            c0__non_null: 3, c0__distinct: 3, c0__min: 1, c0__max: 3, c0__mean: 2, c0__median: 2,
            c1__non_null: 2, c1__distinct: 2, c1__min: 10, c1__max: 20, c1__mean: 15, c1__median: 15,
        }]);
    }
    if (sql.includes("CORR(")) return table(["n", "r"], [{ n: 3, r: 0.5 }]);
    if (sql.includes("PERCENTILE_CONT")) {
        return table(["n", "p25", "p50", "p75", "p90", "p99"], [{ n: 3, p25: 10, p50: 15, p75: 20, p90: 20, p99: 20 }]);
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM")) {
        return table(["ID", "AMOUNT"], ROWS);
    }
    return table(["n"], [{ n: 1 }]);
}

const server = new Server({ name: "fake-snowflake", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "run_sql",
            description: "Run one read-only statement",
            inputSchema: {
                type: "object",
                properties: { statement: { type: "string" }, read_only: { type: "boolean" } },
                required: ["statement", "read_only"],
            },
        },
        {
            name: "describe_table",
            description: "Describe a table",
            inputSchema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] },
        },
        {
            name: "list_objects",
            description: "List databases, schemas or tables",
            inputSchema: { type: "object", properties: { namespace: { type: "array", items: { type: "string" } } } },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    let value: unknown;

    if (name === "run_sql") {
        if (args.read_only !== true) throw new Error("run_sql is only available read-only");
        value = runSql(String(args.statement ?? ""));
    } else if (name === "describe_table") {
        value = table(["column_name", "data_type"], COLUMNS);
    } else if (name === "list_objects") {
        const namespace = Array.isArray(args.namespace) ? args.namespace.map(String) : [];
        value = namespace.length === 0
            ? table(["name"], [{ name: "ANALYTICS" }])
            : namespace.length === 1
                ? table(["name"], [{ name: "PUBLIC" }])
                : table(["name", "table_type"], [{ name: "ORDERS", table_type: "TABLE" }]);
    } else {
        throw new Error(`unknown tool ${name}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(value) }] };
});

await server.connect(new StdioServerTransport());
