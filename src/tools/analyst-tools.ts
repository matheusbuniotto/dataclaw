import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { AnalystPlanDoc } from "../docs/plan";
import { FindingsDoc } from "../docs/findings";
import { PlaybookDoc } from "../docs/playbook";

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
