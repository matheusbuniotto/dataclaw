import { defineExtension, hook, section, ToolTask } from "@earendil-works/pi-durable";
import { AnalystPlanDoc } from "../docs/plan";
import { FindingsDoc } from "../docs/findings";
import { PlaybookDoc } from "../docs/playbook";
import { TelemetryDoc } from "../docs/telemetry";
import {
    calculateStatisticalMetricTool,
    consultPlaybookTool,
    manageHypothesesTool,
    profileDatasetTool,
    recordFindingTool,
    runAnalyticalQueryTool,
} from "../tools/analyst-tools";
import {
    promotePlaybookRuleTool,
    recordHumanFeedbackTool,
    recordReflectionTool,
    triggerAutoImprovementTool,
} from "../tools/auto-improve-tools";
import { requestAuditorReviewTool } from "../subagents/auditor-subagent";
import {
    connectDatabricksTool,
    describeActiveDatabricks,
    listDatabricksAssetsTool,
    profileDatabricksTableTool,
    queryDatabricksTool,
} from "../tools/databricks-tools";
import { AnalysisWorkflowTask } from "../tasks/analysis-workflow";
import { AutoImprovementTask } from "../tasks/auto-improvement";
import { currentWorkspace, workspacePrompt } from "../workspace/context";
import { AgentRosterDoc, formatRosterPrompt } from "../docs/agents";
import {
    agentsArchiveTool,
    agentsCreateTool,
    agentsListTool,
    agentsUpdateTool,
    spawnAgentTool,
    subagentsListTool,
} from "../tools/agent-tools";

export const AnalystExtension = defineExtension({
    name: "durable-analyst",

    // Dynamic prompt sections injected before every model call
    sections: [
        section("project_context", async () => {
            const prompt = await workspacePrompt(currentWorkspace());
            return `# Project Context\n\n${prompt.projectContext}`;
        }),
        section("available_skills", async () => {
            const prompt = await workspacePrompt(currentWorkspace());
            return prompt.skillsPrompt;
        }),
        section("agent_roster", async (input, context) => {
            const roster = await input.read.snapshot(AgentRosterDoc, context);
            return formatRosterPrompt(roster);
        }),
        // 1. Current Analytical Plan & Active Hypotheses
        section("analyst_plan_status", async (input, context) => {
            const plan = await input.read.snapshot(AnalystPlanDoc, input.conversationId, context);
            if (!plan || plan.goal === "Pending goal definition") return undefined;

            const header = `### Active Analytical Plan\nGoal: "${plan.goal}"\nStatus: ${plan.status.toUpperCase()} (Milestone: ${plan.currentMilestone})`;
            const datasetInfo = plan.activeDataset
                ? `Dataset: "${plan.activeDataset.name}" (${plan.activeDataset.rowCount} rows, ${plan.activeDataset.columns.length} columns, source: ${plan.activeDataset.source ?? "file"})`
                : `Dataset: None loaded yet`;

            const sourceInfo = plan.databricks
                ? `Data source: Databricks via MCP (${plan.databricks.host})${plan.databricks.warehouseId ? `, warehouse ${plan.databricks.warehouseId}` : ""}.`
                : `Data source: local files (call connect_databricks to work against Unity Catalog).`;

            const hypList = plan.hypotheses.length > 0
                ? `#### Hypotheses:\n` + plan.hypotheses.map((h) => `- [${h.id}] (${h.status}): ${h.title}`).join("\n")
                : `No hypotheses formulated yet.`;

            return `${header}\n${datasetInfo}\n${sourceInfo}\n${hypList}`;
        }),

        // 2. Live Databricks MCP connection status
        section("databricks_connection", async () => {
            return describeActiveDatabricks();
        }),

        // 3. Verified Findings & Insights
        section("verified_findings", async (input, context) => {
            const findingsDoc = await input.read.snapshot(FindingsDoc, input.conversationId, context);
            if (!findingsDoc || findingsDoc.findings.length === 0) return undefined;

            const list = findingsDoc.findings.map((f) => {
                const auditTag = f.audited ? ` [Audited: ${f.auditVerdict?.toUpperCase()}]` : ` [Unaudited]`;
                return `- **${f.title}** (${f.impact.toUpperCase()} impact, conf: ${f.confidence})${auditTag}\n  Observation: ${f.observation}`;
            }).join("\n");

            return `### Verified Findings & Insights Discovered:\n${list}`;
        }),

        // 4. Auto-Improving Playbook: Learned Rules & Anti-Patterns
        section("auto_improving_playbook", async (input, context) => {
            const playbook = await input.read.snapshot(PlaybookDoc, input.conversationId, context);
            if (!playbook) return undefined;

            const rules = playbook.heuristics.slice(-8).map((h) =>
                `- [${h.domain}] (${h.source}): ${h.rule}`
            ).join("\n");

            const antiPatterns = playbook.antiPatterns.map((a) =>
                `- Avoid ${a.name}: ${a.pattern} (Mitigation: ${a.mitigation})`
            ).join("\n");

            return [
                `### Institutional Analyst Playbook (Version ${playbook.version})`,
                `Apply these learned heuristics and avoid known anti-patterns in your current analysis:`,
                rules,
                `#### Anti-Patterns to Guard Against:`,
                antiPatterns,
            ].join("\n");
        }),
    ],

    // Tools available to the agent
    tools: [
        profileDatasetTool,
        runAnalyticalQueryTool,
        calculateStatisticalMetricTool,
        manageHypothesesTool,
        recordFindingTool,
        consultPlaybookTool,
        connectDatabricksTool,
        queryDatabricksTool,
        listDatabricksAssetsTool,
        profileDatabricksTableTool,
        requestAuditorReviewTool,
        recordReflectionTool,
        recordHumanFeedbackTool,
        promotePlaybookRuleTool,
        triggerAutoImprovementTool,
        agentsListTool,
        agentsCreateTool,
        agentsUpdateTool,
        agentsArchiveTool,
        spawnAgentTool,
        subagentsListTool,
    ],

    // Durable state machines registered in the runtime
    tasks: [
        AnalysisWorkflowTask,
        AutoImprovementTask,
    ],

    // Interceptor lifecycle hooks
    hooks: [
        hook(ToolTask, {
            beforeTool: async (call) => {
                // Security guardrail: prevent DROP, ALTER, TRUNCATE, or DELETE commands
                if (call.name === "run_analytical_query" || call.name === "query_databricks") {
                    const sql = (call.args as any)?.sql ?? "";
                    if (/\b(DROP|ALTER|TRUNCATE|DELETE|INSERT|UPDATE)\b/i.test(sql)) {
                        return { block: "Mutating or destructive SQL operations are strictly blocked on analytical datasets." };
                    }
                }
                return undefined;
            },
            afterTool: async (call, result, api, context) => {
                // If a query encounters an error, record it in telemetry
                const outputText = result.content?.flatMap((c: any) => c.text ?? []).join("") ?? "";
                if (outputText.includes("SQL Execution Error")) {
                    await api.commit(async (tx) => {
                        const telemetry = await tx.doc(TelemetryDoc, api.conversationId);
                        const lastRecord = telemetry.records.slice(-1)[0];
                        if (lastRecord) {
                            lastRecord.errorsEncountered.push(outputText.slice(0, 150));
                        }
                    }, context);
                }
                return result;
            },
        }),
    ],
});
