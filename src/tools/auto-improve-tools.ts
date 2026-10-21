import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { PlaybookDoc } from "../docs/playbook";
import { TelemetryDoc } from "../docs/telemetry";
import { AutoImprovementTask } from "../tasks/auto-improvement";

/**
 * 1. Record Reflection Tool
 * Agent self-critiques its methodology and proposes lessons learned
 */
export const recordReflectionTool = defineTool({
    name: "record_reflection",
    description: "Records a self-critique and post-mortem reflection on an analysis run to drive future auto-improvement.",
    parameters: Type.Object({
        reflectionNote: Type.String({ description: "Reflective assessment of accuracy, methodology, and efficiency" }),
        proposedRules: Type.Optional(Type.Array(Type.String({ description: "Specific rules or heuristics learned for the playbook" }))),
        critiqueScore: Type.Optional(Type.Number({ description: "Self-evaluated score 0.0 to 1.0" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        let recordId = "";

        await api.commit(async (tx) => {
            const telemetry = await tx.doc(TelemetryDoc, api.conversationId);
            recordId = `tel-${telemetry.records.length + 1}`;

            telemetry.records.push({
                id: recordId,
                timestamp: Date.now(),
                workflowName: "analysis_session",
                durationMs: 0,
                hypothesesTested: 1,
                findingsGenerated: 1,
                reflectionNote: args.reflectionNote,
                proposedHeuristics: args.proposedRules ?? [],
                auditCorrections: 0,
                errorsEncountered: [],
            });

            telemetry.totalRuns += 1;
            telemetry.updatedAt = Date.now();
        }, context);

        return {
            content: [{
                type: "text",
                text: `Reflection recorded in telemetry [${recordId}]. Proposed ${args.proposedRules?.length ?? 0} rules for future playbook distillation.`,
            }],
        };
    },
});

/**
 * 2. Record Human Feedback Tool
 * Operators or reviewers can score findings and provide guidance
 */
export const recordHumanFeedbackTool = defineTool({
    name: "record_human_feedback",
    description: "Records external human feedback and quality ratings (1-5 stars) to guide the auto-improvement loop.",
    parameters: Type.Object({
        rating: Type.Number({ description: "Rating from 1 (poor) to 5 (excellent)" }),
        feedback: Type.String({ description: "Qualitative feedback or correction notes" }),
        findingId: Type.Optional(Type.String({ description: "Optional finding ID this feedback refers to" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        let avgRating = 0;

        await api.commit(async (tx) => {
            const telemetry = await tx.doc(TelemetryDoc, api.conversationId);
            const record = telemetry.records.slice(-1)[0] ?? {
                id: `tel-${telemetry.records.length + 1}`,
                timestamp: Date.now(),
                workflowName: "analysis_session",
                durationMs: 0,
                hypothesesTested: 0,
                findingsGenerated: 0,
                auditCorrections: 0,
                errorsEncountered: [],
            };

            record.humanRating = args.rating;
            record.humanFeedback = args.feedback;

            if (!telemetry.records.includes(record)) {
                telemetry.records.push(record);
            }

            const ratings = telemetry.records.flatMap((r) => r.humanRating !== undefined ? [r.humanRating] : []);
            avgRating = ratings.reduce((a, b) => a + b, 0) / (ratings.length || 1);
            telemetry.averageRating = Number(avgRating.toFixed(2));
            telemetry.updatedAt = Date.now();
        }, context);

        api.output(`Received human feedback (Rating: ${args.rating}/5): "${args.feedback}"\n`);

        return {
            content: [{
                type: "text",
                text: `Recorded feedback (Rating: ${args.rating}/5, Global Avg: ${avgRating.toFixed(2)}). Feedback will be ingested during the next auto-improvement cycle.`,
            }],
        };
    },
});

/**
 * 3. Promote Playbook Rule Tool
 * Promotes a validated heuristic or domain rule directly into PlaybookDoc
 */
export const promotePlaybookRuleTool = defineTool({
    name: "promote_playbook_rule",
    description: "Directly commits a newly learned heuristic or anti-pattern to the durable Analyst Playbook, upgrading its version.",
    parameters: Type.Object({
        domain: Type.String({ description: "Domain or category (e.g. 'churn_analysis', 'data_hygiene', 'sql_efficiency')" }),
        rule: Type.String({ description: "The specific actionable rule or heuristic" }),
        confidence: Type.Number({ description: "Confidence score between 0.0 and 1.0" }),
        source: Type.Union([
            Type.Literal("reflection"),
            Type.Literal("human_feedback"),
            Type.Literal("audit_discovery"),
        ]),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        let newVersion = 1;
        let ruleId = "";

        await api.commit(async (tx) => {
            const playbook = await tx.doc(PlaybookDoc, api.conversationId);
            playbook.version += 1;
            newVersion = playbook.version;
            ruleId = `rule-v${newVersion}-${playbook.heuristics.length + 1}`;

            playbook.heuristics.push({
                id: ruleId,
                domain: args.domain,
                rule: args.rule,
                source: args.source,
                confidence: args.confidence,
                timesApplied: 0,
                createdTimestamp: Date.now(),
            });

            playbook.improvementLog.push({
                timestamp: Date.now(),
                reason: `Promoted rule from ${args.source}`,
                addedHeuristicIds: [ruleId],
                notes: args.rule,
            });

            playbook.lastImprovedAt = Date.now();
        }, context);

        api.output(`Playbook upgraded to v${newVersion}! New rule [${ruleId}] in domain "${args.domain}" active.\n`);

        return {
            content: [{
                type: "text",
                text: `Playbook upgraded to Version ${newVersion}. Rule [${ruleId}] is now active and injected into future prompt turns!`,
            }],
        };
    },
});

/**
 * 4. Trigger Auto-Improvement Tool
 * Dispatches the durable AutoImprovementTask workflow
 */
export const triggerAutoImprovementTool = defineTool({
    name: "trigger_auto_improvement",
    description: "Launches the durable AutoImprovementTask to distill past telemetry, audit logs, and feedback into institutional playbook upgrades.",
    parameters: Type.Object({
        focusDomain: Type.Optional(Type.String({ description: "Optional focus domain for the improvement cycle" })),
    }),
    execute: async (args, api, context) => {
        api.output(`Launching AutoImprovementTask...\n`);

        const taskId = await api.createTask(
            AutoImprovementTask,
            { focusDomain: args.focusDomain },
            { ownership: { kind: "task", taskId: api.taskId } },
            context,
        );

        const outcome = await api.waitForTask(taskId, context);
        const { state } = outcome;

        const resultText = state.outcome.status === "completed"
            ? (state.outcome.result as string)
            : `Auto-improvement task failed: ${(state.outcome as any).error?.message}`;

        return {
            content: [{ type: "text", text: resultText }],
        };
    },
});
