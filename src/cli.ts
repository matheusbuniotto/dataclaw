#!/usr/bin/env bun
import { createAnalystHarness } from "./harness";
import { AutoImprovementTask } from "./tasks/auto-improvement";
import { AnalysisWorkflowTask } from "./tasks/analysis-workflow";
import { DatabricksDataAdapter } from "./adapters/databricks-adapter";
import { describeDatabricksConfig } from "./mcp/databricks-config";
import { generateMarkdownReport, generateHtmlReport, generateJsonReport } from "./docs/report-generator";

async function runCli() {
    const args = process.argv.slice(2);
    const command = args[0] ?? "help";
    const storagePath = process.env.ANALYST_STORAGE ?? "./agent_analyst.sqlite";

    if (command === "help" || command === "--help") {
        console.log(`
Durable Analyst Agent CLI (powered by @earendil-works/pi-durable)

Usage:
  bun run src/cli.ts <command> [options]

Commands:
  analyze <filePath> <goal>   Run end-to-end durable analysis on a dataset
  report [md|html|json] [out] Generate an executive intelligence memo from durable state
  auto-improve [domain]       Run the AutoImprovementTask to upgrade the playbook
  playbook                    Display the active institutional playbook heuristics
  findings                    Display the latest verified findings and audit states
  plan                        Display the active analytical plan and hypotheses
  agents                      List specialists the meta-agent can create from chat

  databricks-status           Show the resolved Databricks workspace / MCP endpoint
  databricks-catalogs         List Unity Catalog catalogs over MCP
  databricks-schemas <cat>    List schemas in a catalog
  databricks-tables <cat> <schema>   List tables in a schema
  databricks-describe <table> Describe a fully qualified table
  databricks-profile <table>  Profile a table (rows, nulls, distributions)
  databricks-query <sql>      Run a read-only SQL query over MCP
  help                        Show this help message

Environment:
  .pi/settings.json                      Model (defaultProvider / defaultModel)
  ~/.pi/agent/auth.json                Saved provider credential
  DEFAULT_MODEL_PROVIDER / DEFAULT_MODEL_ID
  DATABRICKS_HOST / DATABRICKS_TOKEN   Workspace + bearer token
  DATABRICKS_PROFILE                   Databricks CLI profile (default DEFAULT)
  DATABRICKS_MCP_URL                   Override the managed SQL MCP endpoint
  DATABRICKS_AUTO_CONNECT=true         Attach Databricks on harness startup
  ANALYST_STORAGE             Path to SQLite storage (default: ./agent_analyst.sqlite)
`);
        return;
    }

    if (command.startsWith("databricks")) {
        await runDatabricksCommand(command, args.slice(1));
        return;
    }

    const analyst = await createAnalystHarness({
        storagePath,
        resume: true,
    });

    try {
        if (command === "analyze") {
            const filePath = args[1] ?? "./sample-data/customer_churn.csv";
            const goal = args[2] ?? "Investigate key business indicators and detect vulnerabilities";

            console.log(`\nLaunching AnalysisWorkflowTask...`);
            console.log(`Target Dataset: ${filePath}`);
            console.log(`Goal: "${goal}"\n`);

            const taskId = await analyst.conversation.commit(async (tx) => {
                return await tx.createTask(
                    AnalysisWorkflowTask,
                    { filePath, targetQuestion: goal },
                    { ownership: { kind: "conversation" } },
                );
            }, analyst.context);

            const result = await analyst.harness.waitForTask(taskId, analyst.context);
            console.log("\n" + (result.state.outcome.status === "completed" ? result.state.outcome.result : "Analysis failed"));
        } else if (command === "auto-improve") {
            const domain = args[1];
            console.log(`\nLaunching AutoImprovementTask${domain ? ` for domain "${domain}"` : ""}...`);

            const taskId = await analyst.conversation.commit(async (tx) => {
                return await tx.createTask(
                    AutoImprovementTask,
                    { focusDomain: domain },
                    { ownership: { kind: "conversation" } },
                );
            }, analyst.context);

            const result = await analyst.harness.waitForTask(taskId, analyst.context);
            console.log("\n" + (result.state.outcome.status === "completed" ? result.state.outcome.result : "Auto-improvement failed"));
        } else if (command === "playbook") {
            const playbook = await analyst.getPlaybook();
            console.log(`\n### Institutional Analyst Playbook (Version ${playbook?.version})`);
            console.log(`Last Improved: ${playbook ? new Date(playbook.lastImprovedAt).toLocaleString() : "Never"}`);
            console.log(`\nActive Heuristics (${playbook?.heuristics.length ?? 0}):`);
            for (const h of playbook?.heuristics ?? []) {
                console.log(`  - [${h.id}] [${h.domain}] (${h.source}, conf=${h.confidence}): ${h.rule}`);
            }
            console.log(`\nAnti-Patterns (${playbook?.antiPatterns.length ?? 0}):`);
            for (const a of playbook?.antiPatterns ?? []) {
                console.log(`  * ${a.name}: ${a.pattern}\n    Mitigation: ${a.mitigation}`);
            }
        } else if (command === "findings") {
            const findings = await analyst.getFindings();
            console.log(`\n### Verified Findings (${findings?.findings.length ?? 0}):`);
            for (const f of findings?.findings ?? []) {
                const audit = f.audited ? ` [Audited: ${f.auditVerdict?.toUpperCase()}]` : " [Unaudited]";
                console.log(`\n* [${f.id}] ${f.title} (${f.impact.toUpperCase()} Impact, Conf: ${f.confidence})${audit}`);
                console.log(`  Observation: ${f.observation}`);
                console.log(`  Recommendations:`);
                for (const r of f.actionableRecommendations) {
                    console.log(`    - ${r}`);
                }
            }
        } else if (command === "agents") {
            const roster = await analyst.getRoster();
            const agents = roster?.agents ?? [];
            console.log(`\n### Agent roster (${agents.length})`);
            if (agents.length === 0) {
                console.log("No specialists yet. Ask DataClaw in the console to create a researcher, writer, or reviewer.");
            }
            for (const agent of agents) {
                console.log(`  - [${agent.id}] ${agent.name} · ${agent.role} · ${agent.status}`);
                console.log(`    ${agent.purpose}`);
                console.log(`    capabilities: ${(agent.capabilities ?? []).join(", ") || "role default"}${agent.contextFiles?.length ? ` · context: ${agent.contextFiles.join(", ")}` : ""}${agent.background ? " · notes" : ""} · compute: ${agent.compute?.kind ?? "shared"}${agent.model ? ` · model: ${agent.model.provider}/${agent.model.modelId}` : ""}`);
            }
            const runs = roster?.runs ?? [];
            console.log(`\nDelegated runs (${runs.length}):`);
            for (const run of runs.slice(-10)) {
                console.log(`  - [${run.id}] ${run.agentName} · ${run.mode} · ${run.status} — ${run.label}`);
            }
        } else if (command === "plan") {
            const plan = await analyst.getPlan();
            console.log(`\n### Active Analytical Plan`);
            console.log(`Goal: "${plan?.goal}"`);
            console.log(`Status: ${plan?.status.toUpperCase()} (Milestone: ${plan?.currentMilestone})`);
            console.log(`Dataset: ${plan?.activeDataset?.name ?? "None"} (${plan?.activeDataset?.rowCount ?? 0} rows, provider: ${plan?.activeDataset?.provider ?? "none"})`);
            const source = plan?.dataSource;
            console.log(source
                ? `Data source: ${source.provider}${source.host ? ` (${source.host})` : ""}${source.endpoint ? ` · ${source.endpoint}` : ""}`
                : "Data source: none (local files only)");
            console.log(`\nHypotheses (${plan?.hypotheses.length ?? 0}):`);
            for (const h of plan?.hypotheses ?? []) {
                console.log(`  - [${h.id}] (${h.status}): ${h.title}`);
            }
        } else if (command === "report") {
            const formatArg = (args[1] === "html" || args[1] === "json" || args[1] === "md") ? args[1] : "md";
            const outArg = args[2] ?? (args[1] && !["html", "json", "md"].includes(args[1]) ? args[1] : undefined);

            const plan = await analyst.getPlan();
            const findings = await analyst.getFindings();
            const playbook = await analyst.getPlaybook();

            const input = { plan, findings, playbook, agentName: "DataClaw" };
            let outputContent = "";

            if (formatArg === "html") {
                outputContent = generateHtmlReport(input);
            } else if (formatArg === "json") {
                outputContent = JSON.stringify(generateJsonReport(input), null, 2);
            } else {
                outputContent = generateMarkdownReport(input);
            }

            if (outArg) {
                const { writeFileSync } = await import("node:fs");
                writeFileSync(outArg, outputContent, "utf-8");
                console.log(`\nExecutive intelligence report exported to ${outArg} (${formatArg.toUpperCase()})`);
            } else {
                console.log("\n" + outputContent);
            }
        } else {
            console.log(`Unknown command: "${command}". Run "bun run src/cli.ts help" for usage.`);
        }
    } finally {
        await analyst.close();
    }
}

runCli().catch(console.error);

async function runDatabricksCommand(command: string, args: string[]) {
    if (command === "databricks-status") {
        const status = describeDatabricksConfig();
        if (!status.configured) {
            console.log(`Databricks is not configured: ${status.error}`);
            return;
        }
        console.log(`Workspace: ${status.host}`);
        console.log(`MCP endpoint: ${status.url}`);
        console.log(`Profile: ${status.profile ?? "(token from environment)"}`);
        return;
    }

    const adapter = await DatabricksDataAdapter.connect();
    try {
        if (command === "databricks-catalogs") {
            const catalogs = await adapter.listCatalogs();
            console.log(catalogs.length ? catalogs.join("\n") : "No catalogs visible.");
        } else if (command === "databricks-schemas") {
            const catalog = args[0];
            if (!catalog) throw new Error("Usage: databricks-schemas <catalog>");
            console.log((await adapter.listSchemas(catalog)).join("\n"));
        } else if (command === "databricks-tables") {
            const [catalog, schema] = args;
            if (!catalog || !schema) throw new Error("Usage: databricks-tables <catalog> <schema>");
            for (const table of await adapter.listTables(catalog, schema)) {
                console.log(`${catalog}.${schema}.${table.name}${table.type ? ` (${table.type})` : ""}`);
            }
        } else if (command === "databricks-describe") {
            const table = args[0];
            if (!table) throw new Error("Usage: databricks-describe <catalog.schema.table>");
            for (const column of await adapter.describeTable(table)) {
                console.log(`${column.name}: ${column.dataType}`);
            }
        } else if (command === "databricks-profile") {
            const table = args[0];
            if (!table) throw new Error("Usage: databricks-profile <catalog.schema.table>");
            const profile = await adapter.profile(table);
            console.log(`Table: ${profile.tableName} (${profile.rowCount} rows, ${profile.columnCount} columns)`);
            for (const column of profile.columns) {
                console.log(`- ${column.name} (${column.type}): nulls=${column.nullCount} (${column.nullPct}%), distinct=${column.distinctCount}`);
            }
        } else if (command === "databricks-query") {
            const sql = args.join(" ");
            if (!sql) throw new Error("Usage: databricks-query <sql>");
            const result = await adapter.query(sql, 50);
            console.table(result.rows);
            console.log(`(${result.rowCount} rows, ${result.executionTimeMs}ms)`);
        } else {
            console.log(`Unknown Databricks command: "${command}". Run "bun run cli help" for usage.`);
        }
    } finally {
        await adapter.close();
    }
}
