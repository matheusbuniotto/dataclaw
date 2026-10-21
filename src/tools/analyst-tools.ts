import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { readFileSync, existsSync } from "fs";
import { SqliteDataAdapter } from "../adapters/sqlite-adapter";
import type { DataAdapter } from "../adapters/adapter-interface";
import { isStoppedError } from "../mcp/mcp-sql-client";
import { AnalystPlanDoc } from "../docs/plan";
import { FindingsDoc } from "../docs/findings";
import { PlaybookDoc } from "../docs/playbook";

// Global or per-session data adapter cache
let sharedAdapter: DataAdapter | null = null;

export async function getOrCreateAdapter(): Promise<DataAdapter> {
    if (!sharedAdapter) {
        sharedAdapter = await SqliteDataAdapter.create(":memory:");
    }
    return sharedAdapter;
}

function bindAbort<T>(
    adapter: DataAdapter,
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
): Promise<T> {
    const bound = adapter as DataAdapter & {
        bindSignal?: (signal: AbortSignal | undefined, run: () => Promise<T>) => Promise<T>;
    };
    return typeof bound.bindSignal === "function" ? bound.bindSignal(signal, run) : run();
}

export function setSharedAdapter(adapter: DataAdapter) {
    sharedAdapter = adapter;
}

/** Drop a Databricks adapter from the shared slot without closing it. The session owner closes it. */
export function releaseSharedAdapter(): void {
    if (sharedAdapter?.source === "databricks") {
        sharedAdapter = null;
    }
}

export function getSharedAdapter(): DataAdapter | null {
    return sharedAdapter;
}

/**
 * 1. Profile Dataset Tool
 * Inspects a file (CSV or JSON), loads into SQLite, and registers schema in AnalystPlanDoc
 */
export const profileDatasetTool = defineTool({
    name: "profile_dataset",
    description: "Loads and profiles a tabular dataset (CSV or JSON), inferring schema, nulls, distributions, and summary stats.",
    parameters: Type.Object({
        filePath: Type.String({ description: "Relative or absolute path to the dataset file (e.g. sample-data/customer_churn.csv)" }),
        tableName: Type.Optional(Type.String({ description: "Target table name in SQL engine, defaults to 'data'" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        api.output(`Profiling dataset from ${args.filePath}...\n`);
        if (!existsSync(args.filePath)) {
            return {
                output: [{ type: "text", text: `Error: File not found at path "${args.filePath}".` }],
                isError: true,
            };
        }

        const content = readFileSync(args.filePath, "utf-8");
        const adapter = await getOrCreateAdapter();
        if (adapter.source === "databricks") {
            return {
                output: [{
                    type: "text",
                    text: "Databricks is the active data source, so local file loading is unavailable. " +
                        "Use profile_databricks_table with a fully qualified Unity Catalog table instead.",
                }],
            };
        }
        const tableName = args.tableName ?? "data";

        let profile;
        if (args.filePath.endsWith(".json")) {
            profile = await adapter.loadJson(tableName, content);
        } else {
            profile = await adapter.loadCsv(tableName, content);
        }

        const summaryLines = profile.columns.map((c) => {
            const stats = c.mean !== undefined ? ` [min=${c.min}, max=${c.max}, avg=${c.mean}]` : "";
            return `- **${c.name}** (${c.type}): nulls=${c.nullCount} (${c.nullPct}%), distinct=${c.distinctCount}${stats}`;
        });

        const profileText = [
            `### Dataset Profile: Table "${profile.tableName}"`,
            `Total Rows: ${profile.rowCount} | Total Columns: ${profile.columnCount}`,
            `#### Columns:`,
            ...summaryLines,
        ].join("\n");

        // Atomically update AnalystPlanDoc
        await api.commit(async (tx) => {
            const plan = await tx.doc(AnalystPlanDoc, api.conversationId);
            plan.activeDataset = {
                name: profile.tableName,
                source: "file",
                sourcePath: args.filePath,
                rowCount: profile.rowCount,
                columns: profile.columns.map((c) => c.name),
                profileSummary: profileText,
            };
            plan.status = "investigating";
            plan.currentMilestone = "Exploratory Analysis & Query Formulation";
            plan.updatedAt = Date.now();
        }, context);

        api.output(`Completed profiling: ${profile.rowCount} rows across ${profile.columnCount} columns.\n`);

        return {
            output: [{ type: "text", text: profileText }],
        };
    },
});

/**
 * 2. Run Analytical Query Tool
 * Runs SQL queries against loaded datasets with execution timing and safety checks
 */
export const runAnalyticalQueryTool = defineTool({
    name: "run_analytical_query",
    description: "Executes a read-only SQL query against the active data source (local SQLite table 'data' or Databricks Unity Catalog) and returns results.",
    parameters: Type.Object({
        sql: Type.String({ description: "SQL query to execute (e.g. SELECT plan_tier, AVG(churned) FROM data GROUP BY plan_tier)" }),
        rationale: Type.String({ description: "Why this query is being run and what hypothesis it tests" }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        api.output(`Executing query: ${args.sql}\nRationale: ${args.rationale}\n`);
        const adapter = await getOrCreateAdapter();

        try {
            const res = await bindAbort(adapter, context.abortSignal, () => adapter.query(args.sql));
            const markdownRows = res.rows.map((r) => `| ${Object.values(r).join(" | ")} |`);
            const header = res.columns.length > 0 ? `| ${res.columns.join(" | ")} |\n| ${res.columns.map(() => "---").join(" | ")} |` : "Empty result";

            const resultText = [
                `Query executed in ${res.executionTimeMs}ms (returned ${res.rowCount} rows):`,
                header,
                ...markdownRows.slice(0, 50),
                res.rowCount > 50 ? `...and ${res.rowCount - 50} more rows.` : "",
            ].filter(Boolean).join("\n");

            return {
                output: [{ type: "text", text: resultText }],
            };
        } catch (err: any) {
            if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
            return {
                output: [{ type: "text", text: `SQL Execution Error: ${err.message}` }],
                isError: true,
            };
        }
    },
});

/**
 * 3. Calculate Statistical Metric Tool
 * Computes Pearson correlation or distribution percentiles
 */
export const calculateStatisticalMetricTool = defineTool({
    name: "calculate_statistical_metric",
    description: "Calculates advanced statistical metrics like Pearson correlation or column percentiles (p25, p50, p75, p90, p99).",
    parameters: Type.Object({
        metricType: Type.Union([Type.Literal("correlation"), Type.Literal("percentiles")]),
        colA: Type.String({ description: "Target column name" }),
        colB: Type.Optional(Type.String({ description: "Second column name (required for correlation)" })),
        tableName: Type.Optional(Type.String({ description: "Table name (defaults to the active dataset)" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        const adapter = await getOrCreateAdapter();
        try {
            const metric = await bindAbort(adapter, context.abortSignal, () => adapter.calculateMetric(args.metricType, {
                tableName: args.tableName,
                colA: args.colA,
                colB: args.colB,
                col: args.colA,
            }));

            return {
                output: [{ type: "text", text: `Metric Result:\n\`\`\`json\n${JSON.stringify(metric, null, 2)}\n\`\`\`` }],
            };
        } catch (err: any) {
            if (context.abortSignal?.aborted || isStoppedError(err)) throw err;
            return {
                output: [{ type: "text", text: `Calculation Error: ${err.message}` }],
                isError: true,
            };
        }
    },
});

/**
 * 4. Manage Hypotheses Tool
 * Tracks active hypotheses in the durable AnalystPlanDoc
 */
export const manageHypothesesTool = defineTool({
    name: "manage_hypotheses",
    description: "Creates, updates, or lists analytical hypotheses in the durable plan.",
    parameters: Type.Object({
        action: Type.Union([
            Type.Literal("propose"),
            Type.Literal("update_status"),
            Type.Literal("list"),
        ]),
        title: Type.String({ description: "Title or summary of hypothesis" }),
        description: Type.Optional(Type.String({ description: "Full hypothesis description and mechanism" })),
        status: Type.Optional(Type.Union([
            Type.Literal("proposed"),
            Type.Literal("testing"),
            Type.Literal("validated"),
            Type.Literal("refuted"),
            Type.Literal("inconclusive"),
        ])),
        notes: Type.Optional(Type.String({ description: "Findings or evidence supporting the status change" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        let resultMessage = "";

        await api.commit(async (tx) => {
            const plan = await tx.doc(AnalystPlanDoc, api.conversationId);

            if (args.action === "propose") {
                const id = `hyp-${plan.hypotheses.length + 1}`;
                plan.hypotheses.push({
                    id,
                    title: args.title,
                    description: args.description ?? args.title,
                    status: args.status ?? "proposed",
                    evidenceIds: [],
                    ...(args.notes ? { notes: args.notes } : {}),
                    proposedAt: Date.now(),
                    updatedAt: Date.now(),
                });
                resultMessage = `Proposed new hypothesis [${id}]: "${args.title}"`;
            } else if (args.action === "update_status") {
                const hyp = plan.hypotheses.find((h) => h.title.toLowerCase().includes(args.title.toLowerCase()) || h.id === args.title);
                if (hyp) {
                    if (args.status) hyp.status = args.status;
                    if (args.notes) hyp.notes = args.notes;
                    hyp.updatedAt = Date.now();
                    resultMessage = `Updated hypothesis [${hyp.id}] status to "${hyp.status}".`;
                } else {
                    resultMessage = `Hypothesis not found matching "${args.title}".`;
                }
            } else {
                resultMessage = plan.hypotheses.length === 0
                    ? "No hypotheses currently recorded."
                    : plan.hypotheses.map((h) => `- [${h.id}] (${h.status}): ${h.title}`).join("\n");
            }
            plan.updatedAt = Date.now();
        }, context);

        return {
            output: [{ type: "text", text: resultMessage }],
        };
    },
});

/**
 * 5. Record Finding Tool
 * Records a validated insight into the durable FindingsDoc
 */
export const recordFindingTool = defineTool({
    name: "record_finding",
    description: "Records a verified insight or finding into the durable findings store with confidence rating and recommendations.",
    parameters: Type.Object({
        title: Type.String({ description: "Concise headline of the finding" }),
        observation: Type.String({ description: "Detailed empirical observation backed by data" }),
        impact: Type.Union([
            Type.Literal("critical"),
            Type.Literal("high"),
            Type.Literal("medium"),
            Type.Literal("low"),
        ]),
        confidence: Type.Number({ description: "Confidence score between 0.0 and 1.0" }),
        rationale: Type.String({ description: "Statistical or analytical rationale" }),
        queryUsed: Type.Optional(Type.String({ description: "SQL query that provided evidence" })),
        recommendations: Type.Array(Type.String({ description: "Actionable next steps or business recommendations" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        let findingId = "";

        await api.commit(async (tx) => {
            const findings = await tx.doc(FindingsDoc, api.conversationId);
            findingId = `find-${findings.findings.length + 1}`;

            findings.findings.push({
                id: findingId,
                title: args.title,
                observation: args.observation,
                impact: args.impact,
                confidence: args.confidence,
                evidence: {
                    ...(args.queryUsed ? { query: args.queryUsed } : {}),
                    rationale: args.rationale,
                },
                audited: false,
                actionableRecommendations: args.recommendations,
                discoveredAt: Date.now(),
            });

            findings.updatedAt = Date.now();
        }, context);

        api.output(`Recorded Finding [${findingId}]: ${args.title} (${args.impact} impact, confidence: ${args.confidence})\n`);

        return {
            output: [{ type: "text", text: `Finding registered successfully with ID [${findingId}]. Ready for audit or report synthesis.` }],
        };
    },
});

/**
 * 6. Consult Playbook Tool
 * Retrieves learned heuristics and query templates from PlaybookDoc
 */
export const consultPlaybookTool = defineTool({
    name: "consult_playbook",
    description: "Queries the durable Analyst Playbook for learned domain heuristics, proven SQL templates, and known anti-patterns.",
    parameters: Type.Object({
        domain: Type.Optional(Type.String({ description: "Optional filter domain (e.g. 'retention', 'data_hygiene', 'business_metrics')" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        const playbook = await api.commit(async (tx) => {
            const doc = await tx.doc(PlaybookDoc, api.conversationId);
            return {
                version: doc.version,
                lastImprovedAt: doc.lastImprovedAt,
                heuristics: doc.heuristics.map((h) => ({ ...h })),
                antiPatterns: doc.antiPatterns.map((a) => ({ ...a })),
                queryTemplates: doc.queryTemplates.map((q) => ({ ...q })),
            };
        }, context);
        let heuristics = playbook.heuristics;
        if (args.domain) {
            heuristics = heuristics.filter((h) => h.domain.toLowerCase().includes(args.domain!.toLowerCase()));
        }

        const lines = [
            `### Durable Analyst Playbook (Version ${playbook.version})`,
            `Total Heuristics: ${playbook.heuristics.length} | Last Improved: ${new Date(playbook.lastImprovedAt).toISOString()}`,
            `#### Heuristics:`,
            ...heuristics.map((h) => `- [${h.domain}] (${h.source}, conf=${h.confidence}): ${h.rule}`),
            `#### Known Anti-Patterns:`,
            ...playbook.antiPatterns.map((a) => `- **${a.name}**: ${a.pattern} -> Mitigation: ${a.mitigation}`),
            `#### Query Templates:`,
            ...playbook.queryTemplates.map((q) => `- **${q.name}**: \`${q.sqlTemplate}\``),
        ];

        return {
            output: [{ type: "text", text: lines.join("\n") }],
        };
    },
});
