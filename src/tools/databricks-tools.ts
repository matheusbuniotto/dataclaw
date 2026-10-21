import { Type } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord";
import { defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { DatabricksDataAdapter } from "../adapters/databricks-adapter";
import { isStoppedError } from "../mcp/mcp-sql-client";
import { AnalystPlanDoc } from "../docs/plan";
import { getOrCreateAdapter, setSharedAdapter } from "./analyst-tools";

let activeDatabricks: DatabricksDataAdapter | null = null;
let lastReconnectAttempt = 0;
const RECONNECT_COOLDOWN_MS = 30_000;

/** The live Databricks adapter, if this process connected one. */
export function getDatabricksAdapter(): DatabricksDataAdapter | null {
    return activeDatabricks;
}

/** Record the adapter the console or harness just attached, or clear it on disconnect. */
export function noteDatabricksAdapter(adapter: DatabricksDataAdapter | null): void {
    activeDatabricks = adapter;
}

/** Status text for the dynamic system prompt. */
export function describeActiveDatabricks(): string | undefined {
    const adapter = activeDatabricks;
    if (!adapter) return undefined;
    const parts = [
        `Connected to Databricks via MCP at ${adapter.options.host ?? adapter.options.mcpUrl ?? "workspace"}.`,
    ];
    if (adapter.options.profile) parts.push(`CLI profile: ${adapter.options.profile}.`);
    if (adapter.options.warehouseId) parts.push(`Warehouse: ${adapter.options.warehouseId}.`);
    parts.push("Use fully qualified Unity Catalog names (catalog.schema.table) in every query.");
    parts.push("All SQL goes through the read-only MCP tool; mutations are blocked.");
    return parts.join(" ");
}

async function requireDatabricks(
    api: ToolExecutionApi<any>,
    context: Context,
): Promise<DatabricksDataAdapter> {
    const adapter = await getOrCreateAdapter();
    if (adapter.source === "databricks") {
        return adapter as DatabricksDataAdapter;
    }

    // Crash recovery: the process may have restarted after a previous run
    // connected Databricks. The durable plan remembers the workspace.
    if (Date.now() - lastReconnectAttempt > RECONNECT_COOLDOWN_MS) {
        lastReconnectAttempt = Date.now();
        const previous = await api.commit(async (tx) => {
            const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
            if (!plan.databricks?.host) return undefined;
            return {
                host: plan.databricks.host,
                mcpUrl: plan.databricks.mcpUrl,
                ...(plan.databricks.profile ? { profile: plan.databricks.profile } : {}),
                ...(plan.databricks.warehouseId ? { warehouseId: plan.databricks.warehouseId } : {}),
            };
        }, context);
        if (previous?.host) {
            try {
                const restored = await DatabricksDataAdapter.connect({
                    host: previous.host,
                    profile: previous.profile,
                    warehouseId: previous.warehouseId,
                });
                setSharedAdapter(restored);
                noteDatabricksAdapter(restored);
                return restored;
            } catch {
                // Fall through to the actionable error below.
            }
        }
    }

    throw new Error(
        "Databricks is not connected in this process. Call connect_databricks first " +
        "(it uses DATABRICKS_HOST/DATABRICKS_TOKEN or your Databricks CLI profile).",
    );
}

function formatRowsAsMarkdown(columns: string[], rows: Array<Record<string, unknown>>, limit = 50): string {
    if (columns.length === 0) return "Empty result.";
    const escape = (value: unknown) => {
        if (value === null || value === undefined) return "";
        const text = typeof value === "object" ? JSON.stringify(value) : String(value);
        return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
    };
    const header = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
    const body = rows.slice(0, limit).map((row) => `| ${columns.map((column) => escape(row[column])).join(" | ")} |`);
    return [header, ...body].join("\n");
}

function formatProfileText(profile: Awaited<ReturnType<DatabricksDataAdapter["profile"]>>): string {
    const lines = profile.columns.map((column) => {
        const nums = [
            column.min !== undefined ? `min=${column.min}` : undefined,
            column.max !== undefined ? `max=${column.max}` : undefined,
            column.mean !== undefined ? `avg=${column.mean}` : undefined,
            column.median !== undefined ? `median=${column.median}` : undefined,
        ].filter(Boolean).join(", ");
        return `- **${column.name}** (${column.type}): nulls=${column.nullCount} (${column.nullPct}%), distinct=${column.distinctCount}${nums ? ` [${nums}]` : ""}`;
    });

    return [
        `### Databricks Table Profile: ${profile.tableName}`,
        `Total Rows: ${profile.rowCount} | Total Columns: ${profile.columnCount}`,
        `#### Columns:`,
        ...lines,
    ].join("\n");
}

/**
 * 1. Connect Databricks via MCP
 */
export const connectDatabricksTool = defineTool({
    name: "connect_databricks",
    description:
        "Connects DataClaw to a Databricks workspace through the Databricks-managed SQL MCP server " +
        "(/api/2.0/mcp/sql). Authenticates with DATABRICKS_HOST/DATABRICKS_TOKEN or the Databricks CLI " +
        "profile and makes Unity Catalog tables queryable with read-only SQL.",
    parameters: Type.Object({
        profile: Type.Optional(Type.String({ description: "Databricks CLI profile (default: DEFAULT or DATABRICKS_PROFILE)" })),
        host: Type.Optional(Type.String({ description: "Workspace URL override (default: DATABRICKS_HOST or ~/.databrickscfg)" })),
        warehouseId: Type.Optional(Type.String({ description: "Optional SQL warehouse id" })),
        defaultTable: Type.Optional(Type.String({ description: "Default catalog.schema.table for profiling and metrics" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        api.output(`Connecting to Databricks MCP (profile=${args.profile ?? process.env.DATABRICKS_PROFILE ?? "DEFAULT"})...\n`);
        try {
            const adapter = await DatabricksDataAdapter.connect(
                { profile: args.profile, host: args.host, warehouseId: args.warehouseId },
                { defaultTable: args.defaultTable },
            );

            let catalogs: string[] = [];
            try {
                catalogs = await adapter.bindSignal(context.abortSignal, () => adapter.listCatalogs());
            } catch (err) {
                if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
                // Connection works even if catalog listing is forbidden.
            }

            setSharedAdapter(adapter);
            noteDatabricksAdapter(adapter);

            await api.commit(async (tx) => {
                const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
                plan.databricks = {
                    host: adapter.options.host ?? "unknown",
                    mcpUrl: adapter.options.mcpUrl ?? "",
                    ...(adapter.options.profile ? { profile: adapter.options.profile } : {}),
                    ...(adapter.options.warehouseId ? { warehouseId: adapter.options.warehouseId } : {}),
                    connectedAt: Date.now(),
                };
                plan.status = "investigating";
                plan.currentMilestone = "Databricks Data Exploration";
                plan.updatedAt = Date.now();
            }, context);

            const summary = [
                `Connected to Databricks workspace ${adapter.options.host ?? "(unknown host)"} via MCP.`,
                `Endpoint: ${adapter.options.mcpUrl ?? "(unknown)"}`,
                catalogs.length > 0 ? `Visible catalogs: ${catalogs.join(", ")}` : "No catalogs were listed (permissions?).",
                "Next: list_databricks_assets -> profile_databricks_table -> query_databricks.",
            ].join("\n");

            api.output(`Databricks MCP connection established.\n`);
            return { output: [{ type: "text", text: summary }] };
        } catch (err: any) {
            if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
            return {
                output: [{
                    type: "text",
                    text: `Failed to connect to Databricks via MCP: ${err?.message ?? String(err)}`,
                }],
            };
        }
    },
});

/**
 * 2. Query Databricks (read-only)
 */
export const queryDatabricksTool = defineTool({
    name: "query_databricks",
    description:
        "Executes read-only SQL against Databricks Unity Catalog (Databricks SQL syntax). " +
        "Always use fully qualified names such as catalog.schema.table. Use connect_databricks first.",
    parameters: Type.Object({
        sql: Type.String({ description: "Read-only SQL query (SELECT/WITH/SHOW/DESCRIBE)." }),
        rationale: Type.String({ description: "Why this query is being run and which hypothesis it tests." }),
        maxRows: Type.Optional(Type.Number({ description: "Maximum rows to return (default 200)." })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        api.output(`Databricks query: ${args.sql}\nRationale: ${args.rationale}\n`);
        try {
            const adapter = await requireDatabricks(api, context);
            const result = await adapter.bindSignal(
                context.abortSignal,
                () => adapter.query(args.sql, args.maxRows ?? 200),
            );

            const body = formatRowsAsMarkdown(result.columns, result.rows);
            const text = [
                `Query executed in ${result.executionTimeMs}ms on Databricks (returned ${result.rowCount} rows):`,
                body,
                result.rowCount > result.rows.length ? `...showing ${result.rows.length} of ${result.rowCount} rows.` : "",
            ].filter(Boolean).join("\n");

            return { output: [{ type: "text", text }] };
        } catch (err: any) {
            if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
            return { output: [{ type: "text", text: `Databricks Query Error: ${err?.message ?? String(err)}` }], isError: true };
        }
    },
});

/**
 * 3. Discover catalogs, schemas, tables, and columns
 */
export const listDatabricksAssetsTool = defineTool({
    name: "list_databricks_assets",
    description:
        "Explores the Databricks Unity Catalog over MCP: list catalogs, schemas in a catalog, tables in a schema, " +
        "or describe the columns of a table.",
    parameters: Type.Object({
        action: Type.Union([
            Type.Literal("catalogs"),
            Type.Literal("schemas"),
            Type.Literal("tables"),
            Type.Literal("describe"),
        ]),
        catalog: Type.Optional(Type.String({ description: "Catalog name (required for schemas/tables)." })),
        schema: Type.Optional(Type.String({ description: "Schema name (required for tables)." })),
        table: Type.Optional(Type.String({ description: "Fully qualified table (required for describe)." })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        try {
            const adapter = await requireDatabricks(api, context);
            return await adapter.bindSignal(context.abortSignal, async () => {
            if (args.action === "catalogs") {
                const catalogs = await adapter.listCatalogs();
                return {
                    output: [{
                        type: "text",
                        text: catalogs.length
                            ? `Catalogs:\n${catalogs.map((catalog) => `- ${catalog}`).join("\n")}`
                            : "No catalogs visible to this identity.",
                    }],
                };
            }

            if (args.action === "schemas") {
                if (!args.catalog) throw new Error("catalog is required for action=schemas.");
                const schemas = await adapter.listSchemas(args.catalog);
                return {
                    output: [{
                        type: "text",
                        text: schemas.length
                            ? `Schemas in ${args.catalog}:\n${schemas.map((schema) => `- ${schema}`).join("\n")}`
                            : `No schemas visible in ${args.catalog}.`,
                    }],
                };
            }

            if (args.action === "tables") {
                if (!args.catalog || !args.schema) throw new Error("catalog and schema are required for action=tables.");
                const tables = await adapter.listTables(args.catalog, args.schema);
                return {
                    output: [{
                        type: "text",
                        text: tables.length
                            ? `Tables in ${args.catalog}.${args.schema}:\n` +
                            tables.map((table) => `- ${args.catalog}.${args.schema}.${table.name}${table.type ? ` (${table.type})` : ""}`).join("\n")
                            : `No tables visible in ${args.catalog}.${args.schema}.`,
                    }],
                };
            }

            if (!args.table) throw new Error("table is required for action=describe.");
            const columns = await adapter.describeTable(args.table);
            return {
                output: [{
                    type: "text",
                    text: `Columns in ${args.table}:\n` +
                        columns.map((column) => `- ${column.name}: ${column.dataType}`).join("\n"),
                }],
            };
            });
        } catch (err: any) {
            if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
            return { output: [{ type: "text", text: `Databricks Discovery Error: ${err?.message ?? String(err)}` }], isError: true };
        }
    },
});

/**
 * 4. Profile a Unity Catalog table and update the durable plan
 */
export const profileDatabricksTableTool = defineTool({
    name: "profile_databricks_table",
    description:
        "Profiles a Databricks Unity Catalog table over MCP (row count, nulls, distinct counts, min/max/mean/median) " +
        "and records it as the active dataset in the durable AnalystPlanDoc.",
    parameters: Type.Object({
        table: Type.String({ description: "Fully qualified table name (catalog.schema.table)." }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        api.output(`Profiling Databricks table ${args.table}...\n`);
        try {
            const adapter = await requireDatabricks(api, context);
            const profile = await adapter.bindSignal(context.abortSignal, () => adapter.profile(args.table));
            adapter.setActiveTable(args.table);

            const profileText = formatProfileText(profile);
            const parts = args.table.split(".");
            const catalog = parts.length >= 3 ? parts[parts.length - 3] : undefined;
            const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;

            await api.commit(async (tx) => {
                const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
                plan.activeDataset = {
                    name: profile.tableName,
                    source: "databricks",
                    ...(catalog ? { catalog } : {}),
                    ...(schema ? { schema } : {}),
                    rowCount: profile.rowCount,
                    columns: profile.columns.map((column) => column.name),
                    profileSummary: profileText,
                };
                plan.status = "investigating";
                plan.currentMilestone = "Exploratory Analysis & Query Formulation";
                plan.updatedAt = Date.now();
            }, context);

            api.output(`Profiled ${profile.rowCount} rows across ${profile.columnCount} columns.\n`);
            return { output: [{ type: "text", text: profileText }] };
        } catch (err: any) {
            if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
            return { output: [{ type: "text", text: `Databricks Profiling Error: ${err?.message ?? String(err)}` }], isError: true };
        }
    },
});
