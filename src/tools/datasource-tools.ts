/**
 * The seven tools the model uses for data, whatever the source.
 *
 * Every tool goes through the conversation's `DataSourceSession`: it never sees an adapter, a
 * transport, a dialect, or a provider name. That is what lets a new data MCP arrive as a manifest.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { existsSync, readFileSync } from "node:fs";
import type { DatasetProfile, QueryResult } from "../adapters/adapter-interface";
import type { DataSourceRegistry } from "../datasource/session";
import { SourceError, type Discovery } from "../datasource/types";
import { AnalystPlanDoc } from "../docs/plan";
import { recordActiveDataset } from "../docs/writers";

export interface DataSourceToolsOptions {
    /** Late-bound: the registry is created after the harness opens, tools before. */
    sessions: () => DataSourceRegistry;
}

function textResult(text: string) {
    return { output: [{ type: "text" as const, text }] };
}

function failure(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = err instanceof SourceError && err.hint ? `\n${err.hint}` : "";
    return { output: [{ type: "text" as const, text: `${message}${hint}` }], isError: true };
}

export function formatRows(result: QueryResult, limit = 50): string {
    if (result.columns.length === 0) return "Empty result.";
    const escape = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        const text = typeof value === "object" ? JSON.stringify(value) : String(value);
        return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
    };
    const header = `| ${result.columns.join(" | ")} |\n| ${result.columns.map(() => "---").join(" | ")} |`;
    const body = result.rows.slice(0, limit).map((row) =>
        `| ${result.columns.map((column) => escape(row[column])).join(" | ")} |`);
    return [
        `Query executed in ${result.executionTimeMs}ms (returned ${result.rowCount} rows):`,
        header,
        ...body,
        result.rowCount > limit ? `...showing ${limit} of ${result.rowCount} rows.` : "",
    ].filter(Boolean).join("\n");
}

export function formatProfile(profile: DatasetProfile): string {
    const columns = profile.columns.map((column) => {
        const stats = [
            column.min !== undefined ? `min=${column.min}` : "",
            column.max !== undefined ? `max=${column.max}` : "",
            column.mean !== undefined ? `avg=${column.mean}` : "",
            column.median !== undefined ? `median=${column.median}` : "",
        ].filter(Boolean).join(", ");
        return `- **${column.name}** (${column.type}): nulls=${column.nullCount} (${column.nullPct}%), ` +
            `distinct=${column.distinctCount}${stats ? ` [${stats}]` : ""}`;
    });
    return [
        `### Dataset Profile: ${profile.tableName}`,
        `Total Rows: ${profile.rowCount} | Total Columns: ${profile.columnCount}`,
        "#### Columns:",
        ...columns,
    ].join("\n");
}

export function createDataSourceTools(options: DataSourceToolsOptions) {
    const session = (conversationId: string | number) => options.sessions().for(conversationId);

    const listDataSourcesTool = defineTool({
        name: "list_data_sources",
        description: "Lists the data sources this workspace can connect to, and which one is live for this conversation.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async (_args, api) => {
            const current = session(api.conversationId);
            const status = current.status();
            const lines = ["### Data sources"];
            for (const provider of options.sessions().providers()) {
                const live = status.state === "live" && status.record.provider === provider.id ? " ← live" : "";
                lines.push(`- **${provider.id}** (${provider.kind}, dialect ${provider.dialect})${live}: ${provider.label}`);
            }
            if (status.state === "live") {
                const record = status.record;
                lines.push(
                    "",
                    `Live: ${record.provider}${record.host ? ` (${record.host})` : ""}` +
                    `${record.dataset ? `, dataset ${record.dataset}` : ""}.`,
                );
            } else if (status.state === "failed") {
                lines.push("", `Last connect failed: ${status.error.message}`);
            } else {
                lines.push("", "Nothing is connected. Call connect_data_source, or load_dataset for a local file.");
            }
            return textResult(lines.join("\n"));
        },
    });

    const connectDataSourceTool = defineTool({
        name: "connect_data_source",
        description:
            "Connects to a data source: Databricks, local files, or any installed data-source plugin. " +
            "Authenticates from the environment or a CLI profile; never pass a token.",
        parameters: Type.Object({
            provider: Type.String({ description: "Source id from list_data_sources, e.g. databricks" }),
            profile: Type.Optional(Type.String({ description: "CLI profile name, for a source that uses one" })),
            host: Type.Optional(Type.String({ description: "Workspace or account URL override" })),
            dataset: Type.Optional(Type.String({ description: "Dataset to select after connecting" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            try {
                const record = await session(api.conversationId).connect({
                    provider: args.provider,
                    ...(args.profile ? { credential: { kind: "cli-profile" as const, profile: args.profile } } : {}),
                    ...(args.host ? { host: args.host } : {}),
                    ...(args.dataset ? { dataset: args.dataset } : {}),
                });
                await api.commit(async (tx) => {
                    const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
                    plan.status = "investigating";
                    plan.currentMilestone = "Data Exploration";
                    plan.updatedAt = Date.now();
                }, context);
                return textResult(
                    `Connected to ${record.provider} (dialect ${record.dialect})` +
                    `${record.host ? ` at ${record.host}` : ""}.\n` +
                    "Next: discover_data, then profile_table, then query_data.",
                );
            } catch (err) {
                if (context.abortSignal?.aborted) throw err;
                return failure(err);
            }
        },
    });

    const discoverDataTool = defineTool({
        name: "discover_data",
        description:
            "Explores the live source: list what is inside a namespace, or describe a dataset's columns. " +
            "Pass namespace as dot-separated parts, e.g. \"catalog.schema\" or \"project.dataset\".",
        parameters: Type.Object({
            step: Type.Union([Type.Literal("children"), Type.Literal("columns")]),
            namespace: Type.Optional(Type.String({ description: "Dot-separated namespace to list inside, when step=children" })),
            dataset: Type.Optional(Type.String({ description: "Fully qualified dataset, when step=columns" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            const namespace = args.namespace
                ? args.namespace.split(".").map((part) => part.trim()).filter(Boolean)
                : undefined;
            try {
                const found = args.step === "columns"
                    ? await session(api.conversationId).discover(
                        { step: "columns", dataset: requireDataset(args.dataset) },
                        { signal: context.abortSignal },
                    )
                    : await session(api.conversationId).discover(
                        { step: "children", ...(namespace ? { scope: { namespace } } : {}) },
                        { signal: context.abortSignal },
                    );
                return textResult(renderDiscovery(found));
            } catch (err) {
                if (context.abortSignal?.aborted) throw err;
                return failure(err);
            }
        },
    });

    const profileTableTool = defineTool({
        name: "profile_table",
        description:
            "Profiles a dataset on the live source (rows, nulls, distinct counts, min/max/mean/median) " +
            "and records it as the active dataset in the durable plan.",
        parameters: Type.Object({
            dataset: Type.String({ description: "Fully qualified dataset name in the source's own convention" }),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            api.output(`Profiling ${args.dataset}...\n`);
            try {
                const current = session(api.conversationId);
                const result = await current.profile(args.dataset, { signal: context.abortSignal });
                const text = formatProfile(result.profile);
                const status = current.status();
                const provider = status.state === "live" ? status.record.provider : undefined;

                await api.commit(async (tx) => {
                    await recordActiveDataset(tx, api.conversationId, {
                        name: result.profile.tableName,
                        ...(provider ? { provider } : {}),
                        rowCount: result.profile.rowCount,
                        columns: result.profile.columns.map((column) => column.name),
                        profileSummary: text,
                    });
                    const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
                    plan.status = "investigating";
                    plan.currentMilestone = "Exploratory Analysis & Query Formulation";
                    plan.updatedAt = Date.now();
                }, context);

                const derivation = result.derivation === "native"
                    ? "Profiled by the source."
                    : `Profiled with ${result.derivation}.`;
                return textResult(`${text}\n\n${derivation}`);
            } catch (err) {
                if (context.abortSignal?.aborted) throw err;
                return failure(err);
            }
        },
    });

    const queryDataTool = defineTool({
        name: "query_data",
        description:
            "Executes read-only SQL against the live data source (local SQLite, Databricks Unity Catalog, " +
            "or an installed source). Use the source's own naming; every statement must be read-only.",
        parameters: Type.Object({
            sql: Type.String({ description: "Read-only SQL query" }),
            rationale: Type.String({ description: "Why this query is being run and which hypothesis it tests" }),
            maxRows: Type.Optional(Type.Number({ description: "Maximum rows to return (default 200)" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            api.output(`Executing query: ${args.sql}\nRationale: ${args.rationale}\n`);
            try {
                const result = await session(api.conversationId).query(args.sql, {
                    ...(args.maxRows !== undefined ? { maxRows: args.maxRows } : {}),
                    signal: context.abortSignal,
                });
                return textResult(`${formatRows(result)}\n\nRationale: ${args.rationale}`);
            } catch (err) {
                if (context.abortSignal?.aborted) throw err;
                return failure(err);
            }
        },
    });

    const calculateMetricTool = defineTool({
        name: "calculate_metric",
        description:
            "Computes a statistical metric on the live source: Pearson correlation or column percentiles " +
            "(p25, p50, p75, p90, p99).",
        parameters: Type.Object({
            metric: Type.Union([Type.Literal("correlation"), Type.Literal("percentiles")]),
            colA: Type.String({ description: "Column name (the only column for percentiles)" }),
            colB: Type.Optional(Type.String({ description: "Second column, required for correlation" })),
            dataset: Type.Optional(Type.String({ description: "Dataset name; defaults to the active dataset" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            try {
                const spec = args.metric === "correlation"
                    ? {
                        kind: "correlation" as const,
                        columns: [args.colA, requireColumn(args.colB)] as [string, string],
                        ...(args.dataset ? { dataset: args.dataset } : {}),
                    }
                    : {
                        kind: "percentiles" as const,
                        column: args.colA,
                        ...(args.dataset ? { dataset: args.dataset } : {}),
                    };
                const metric = await session(api.conversationId).metric(spec, { signal: context.abortSignal });
                return textResult(`Metric result (${metric.derivation}):\n\`\`\`json\n${JSON.stringify(metric, null, 2)}\n\`\`\``);
            } catch (err) {
                if (context.abortSignal?.aborted) throw err;
                return failure(err);
            }
        },
    });

    const loadDatasetTool = defineTool({
        name: "load_dataset",
        description:
            "Loads a local CSV or JSON file into the local data source and profiles it. Only for local " +
            "files; use profile_table for a warehouse table.",
        parameters: Type.Object({
            filePath: Type.String({ description: "Relative or absolute path to a CSV or JSON file" }),
            tableName: Type.Optional(Type.String({ description: "Table name in the local engine; defaults to 'data'" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            api.output(`Loading ${args.filePath}...\n`);
            try {
                const current = session(api.conversationId);
                if (!current.intake) {
                    if (current.status().state === "live") {
                        const record = current.status();
                        throw new SourceError(
                            "unsupported-capability",
                            record.state === "live"
                                ? `${record.record.provider} is the live source, so local files are unavailable.`
                                : "The live source cannot load local files.",
                            {
                                hint: "Use profile_table and query_data with a fully qualified table instead.",
                            },
                        );
                    }
                    await current.connect({ provider: "local" });
                }
                if (!existsSync(args.filePath)) {
                    throw new SourceError("query-error", `File not found at "${args.filePath}".`);
                }

                const content = readFileSync(args.filePath, "utf-8");
                const tableName = args.tableName ?? "data";
                const profile = args.filePath.endsWith(".json")
                    ? await current.intake!.loadJson(tableName, content)
                    : await current.intake!.loadCsv(tableName, content);
                const text = formatProfile(profile);

                await api.commit(async (tx) => {
                    await recordActiveDataset(tx, api.conversationId, {
                        name: profile.tableName,
                        provider: "local",
                        sourcePath: args.filePath,
                        rowCount: profile.rowCount,
                        columns: profile.columns.map((column) => column.name),
                        profileSummary: text,
                    });
                    const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
                    plan.status = "investigating";
                    plan.currentMilestone = "Exploratory Analysis & Query Formulation";
                    plan.updatedAt = Date.now();
                }, context);

                api.output(`Loaded ${profile.rowCount} rows across ${profile.columnCount} columns.\n`);
                return textResult(`${text}\n\nLoaded into the local source as table "${profile.tableName}".`);
            } catch (err) {
                if (context.abortSignal?.aborted) throw err;
                return failure(err);
            }
        },
    });

    return {
        listDataSourcesTool,
        connectDataSourceTool,
        discoverDataTool,
        profileTableTool,
        queryDataTool,
        calculateMetricTool,
        loadDatasetTool,
        all: [
            listDataSourcesTool,
            connectDataSourceTool,
            discoverDataTool,
            profileTableTool,
            queryDataTool,
            calculateMetricTool,
            loadDatasetTool,
        ],
    };
}

function requireDataset(dataset: string | undefined): string {
    if (!dataset?.trim()) throw new SourceError("not-configured", "step=columns needs a dataset.", {
        hint: "Pass the fully qualified dataset name.",
    });
    return dataset;
}

function requireColumn(column: string | undefined): string {
    if (!column?.trim()) throw new SourceError("not-configured", "Correlation needs two columns.", {
        hint: "Pass colB as well as colA.",
    });
    return column;
}

function renderDiscovery(found: readonly Discovery[]): string {
    if (found.length === 0) return "Nothing found at that level.";
    return found
        .map((entry) => `- ${entry.name} (${entry.kind}${entry.detail ? `, ${entry.detail}` : ""})`)
        .join("\n");
}
