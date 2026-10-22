/**
 * The analyst extension: prompt sections, the model's tools, the durable tasks, and the SQL guard.
 *
 * Built per harness by a factory, because the data tools need the harness's `DataSourceRegistry`
 * and a module-level singleton would recreate the global this refactor removed. The registry is
 * late-bound: tools are registered before the harness opens, called after.
 */
import { defineExtension, hook, section, ToolTask } from "@earendil-works/pi-durable";
import { AnalystPlanDoc } from "../docs/plan";
import { FindingsDoc } from "../docs/findings";
import { PlaybookDoc } from "../docs/playbook";
import { TelemetryDoc } from "../docs/telemetry";
import { consultPlaybookTool, manageHypothesesTool, recordFindingTool } from "../tools/analyst-tools";
import {
    promotePlaybookRuleTool,
    recordHumanFeedbackTool,
    recordReflectionTool,
    triggerAutoImprovementTool,
} from "../tools/auto-improve-tools";
import { createAuditorReviewTool } from "../subagents/auditor-subagent";
import { AnalysisWorkflowTask } from "../tasks/analysis-workflow";
import { AutoImprovementTask } from "../tasks/auto-improvement";
import { currentWorkspace, workspacePrompt, loadAgentContextFiles, formatSkillsForPrompt } from "../workspace/context";
import { AgentBindingDoc, AgentRosterDoc, formatRosterPrompt, normalizedAgentProfile } from "../docs/agents";
import { formatCapabilities } from "../docs/agent-capabilities";
import { computeCwd, formatCompute } from "../compute/agent-compute";
import {
    agentsArchiveTool,
    agentsCreateTool,
    agentsInspectTool,
    agentsListTool,
    agentsUpdateTool,
    spawnAgentTool,
    subagentsListTool,
} from "../tools/agent-tools";
import {
    featuresApplyTool,
    featuresCreatePluginTool,
    featuresCreateSkillTool,
    featuresListTool,
    featuresRemovePluginTool,
    featuresRemoveSkillTool,
} from "../tools/feature-tools";
import { createDataSourceTools } from "../tools/datasource-tools";
import { toolDeclaration } from "../tools/inventory";
import { isReadOnlySql } from "../mcp/mcp-sql-client";
import type { DataSourceRegistry } from "../datasource/session";

export interface AnalystToolsOptions {
    /** Late-bound: the registry exists once the harness opens. */
    sessions: () => DataSourceRegistry;
}

export function createAnalystTools(options: AnalystToolsOptions) {
    const data = createDataSourceTools({ sessions: options.sessions });
    const requestAuditorReviewTool = createAuditorReviewTool({
        tools: [data.queryDataTool, data.discoverDataTool],
    });

    return defineExtension({
        name: "durable-analyst",

        // Dynamic prompt sections injected before every model call
        sections: [
            section("project_context", async () => {
                const prompt = await workspacePrompt(currentWorkspace());
                return `# Project Context\n\n${prompt.projectContext}`;
            }),
            section("available_skills", async (input, context) => {
                const prompt = await workspacePrompt(currentWorkspace());
                const binding = await input.read.snapshot(AgentBindingDoc, input.conversationId, context);
                if (!binding?.agentId) return prompt.skillsPrompt;
                const roster = await input.read.snapshot(AgentRosterDoc, context);
                const agent = roster?.agents.find((item) => item.id === binding.agentId);
                const selected = agent ? normalizedAgentProfile(agent).skills : [];
                if (selected.length === 0) return prompt.skillsPrompt;
                return formatSkillsForPrompt(prompt.skills.filter((skill) => selected.includes(skill.name)));
            }),
            section("agent_profile", async (input, context) => {
                const binding = await input.read.snapshot(AgentBindingDoc, input.conversationId, context);
                if (!binding?.agentId) return undefined;
                const roster = await input.read.snapshot(AgentRosterDoc, context);
                const agent = roster?.agents.find((item) => item.id === binding.agentId);
                if (!agent) return undefined;

                const ready = normalizedAgentProfile(agent);
                const workspace = currentWorkspace();
                const knowledge = await loadAgentContextFiles(ready.contextFiles, workspace);
                const lines = [
                    "### Specialist profile",
                    `You are ${agent.name}, a ${agent.role} specialist in DataClaw.`,
                    `Purpose: ${agent.purpose}`,
                    `Capabilities: ${formatCapabilities(ready.capabilities)}`,
                    `Compute: ${formatCompute(ready.compute)} at ${computeCwd(agent.id, ready.compute, workspace.workspaceDir)}. Files you write and shell commands stay in this compute.`,
                    "Stay within these capabilities. If the task needs a tool you do not have, say so and return the request to the coordinator; do not pretend to run it.",
                ];
                if (ready.background) {
                    lines.push("", "#### Background", ready.background);
                }
                for (const file of knowledge.files) {
                    lines.push("", `#### Knowledge: ${file.path}`, file.content.trimEnd());
                }
                if (knowledge.missing.length > 0) {
                    lines.push("", `Knowledge files not readable: ${knowledge.missing.join(", ")}. Do not invent their contents.`);
                }
                return lines.join("\n");
            }),
            section("agent_roster", async (input, context) => {
                const roster = await input.read.snapshot(AgentRosterDoc, context);
                const binding = await input.read.snapshot(AgentBindingDoc, input.conversationId, context);
                if (binding?.agentId) {
                    const self = (roster?.agents ?? []).find((agent) => agent.id === binding.agentId);
                    if (binding.origin === "run" || !self?.canManage) {
                        return "### Agent roster\nYou are a specialist in this workspace. The coordinator manages the roster; return the result instead of creating or delegating to other agents.";
                    }
                }
                return formatRosterPrompt(roster);
            }),

            // 1. Current Analytical Plan & Active Hypotheses
            section("analyst_plan_status", async (input, context) => {
                const plan = await input.read.snapshot(AnalystPlanDoc, input.conversationId, context);
                if (!plan || plan.goal === "Pending goal definition") return undefined;

                const header = `### Active Analytical Plan\nGoal: "${plan.goal}"\nStatus: ${plan.status.toUpperCase()} (Milestone: ${plan.currentMilestone})`;
                const datasetInfo = plan.activeDataset
                    ? `Dataset: "${plan.activeDataset.name}" (${plan.activeDataset.rowCount} rows, ${plan.activeDataset.columns.length} columns, source: ${plan.activeDataset.provider ?? "local"})`
                    : `Dataset: None loaded yet`;

                const source = plan.dataSource;
                const sourceInfo = source
                    ? `Data source: ${source.provider} via MCP${source.host ? ` (${source.host})` : ""}${source.dataset ? `, dataset ${source.dataset}` : ""}.`
                    : `Data source: local files (connect a data source to work against a warehouse).`;

                const hypList = plan.hypotheses.length > 0
                    ? `#### Hypotheses:\n` + plan.hypotheses.map((h) => `- [${h.id}] (${h.status}): ${h.title}`).join("\n")
                    : `No hypotheses formulated yet.`;

                return `${header}\n${datasetInfo}\n${sourceInfo}\n${hypList}`;
            }),

            // 2. The live data source, as the session sees it
            section("data_source_status", async (input) => {
                const status = options.sessions().for(input.conversationId).status();
                if (status.state === "live") {
                    const record = status.record;
                    return `### Data source\nConnected to ${record.provider} (dialect ${record.dialect})` +
                        `${record.host ? ` at ${record.host}` : ""}. Use query_data, discover_data and profile_table.`;
                }
                if (status.state === "failed") {
                    return `### Data source\nNot connected: ${status.error.message}` +
                        `${status.error.hint ? ` ${status.error.hint}` : ""}`;
                }
                return undefined;
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
            ...data.all,
            manageHypothesesTool,
            recordFindingTool,
            consultPlaybookTool,
            requestAuditorReviewTool,
            recordReflectionTool,
            recordHumanFeedbackTool,
            promotePlaybookRuleTool,
            triggerAutoImprovementTool,
            agentsListTool,
            agentsInspectTool,
            agentsCreateTool,
            agentsUpdateTool,
            agentsArchiveTool,
            spawnAgentTool,
            subagentsListTool,
            featuresListTool,
            featuresCreateSkillTool,
            featuresRemoveSkillTool,
            featuresCreatePluginTool,
            featuresRemovePluginTool,
            featuresApplyTool,
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
                    // Defense in depth: the session and the provider refuse too.
                    if (toolDeclaration(call.name)?.runsSql) {
                        const sql = (call.arguments as { sql?: string }).sql ?? "";
                        // The session and the provider check again; this only stops an obvious mistake early.
                        if (sql.trim() && !isReadOnlySql(sql)) {
                            return { block: "Mutating or destructive SQL operations are strictly blocked on analytical datasets." };
                        }
                    }
                    return undefined;
                },
                afterTool: async (call, result, api, context) => {
                    if (!toolDeclaration(call.name)?.runsSql || !result.isError) return result;
                    const outputText = result.output?.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("") ?? "";
                    await (api as any).commit?.(async (tx: any) => {
                        const telemetry = await tx.doc(TelemetryDoc, api.conversationId);
                        const lastRecord = telemetry.records.slice(-1)[0];
                        if (lastRecord) lastRecord.errorsEncountered.push(outputText.slice(0, 150));
                    }, context);
                    return result;
                },
            }),
        ],
    });
}
