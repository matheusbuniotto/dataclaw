import { Type } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, configure, defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { FindingsDoc } from "../docs/findings";

export type AuditVerdict = "confirmed" | "caution" | "rejected";

/**
 * Read the verdict from the auditor's "VERDICT: X" line.
 * A reply without one is "caution": an unreadable audit must not confirm a finding.
 */
export function parseAuditVerdict(report: string): AuditVerdict {
    const match = /VERDICT\W*(CONFIRMED|CAUTION|REJECTED)\b/i.exec(report);
    return (match?.[1]?.toLowerCase() as AuditVerdict | undefined) ?? "caution";
}

export interface AuditorToolOptions {
    /** The data tools the auditor may re-run the evidence with. */
    tools: readonly ToolRegistration[];
}

export function createAuditorReviewTool(options: AuditorToolOptions) {
    return defineTool({
    name: "request_auditor_review",
    description: "Spawns a dedicated Critic & Statistical Auditor Subagent to challenge a proposed finding, check for biases, and confirm validity.",
    parameters: Type.Object({
        findingId: Type.String({ description: "ID of the finding to audit (e.g. find-1)" }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        // 1. Fetch finding details (snapshot inside the commit; doc overlays settle afterwards)
        const finding = await api.commit(async (tx) => {
            const findingsDoc = await tx.doc(FindingsDoc, api.conversationId);
            const target = findingsDoc.findings.find((f) => f.id === args.findingId);
            return target
                ? {
                    ...target,
                    evidence: { ...target.evidence },
                    actionableRecommendations: [...target.actionableRecommendations],
                }
                : undefined;
        }, context);
        if (!finding) {
            return { output: [{ type: "text", text: `Error: Finding with ID "${args.findingId}" not found.` }], isError: true };
        }

        api.output(`Spawning Auditor Subagent for finding [${args.findingId}]: "${finding.title}"...\n`);

        // 2. Atomically get or create the child subagent conversation
        const childConvId = await api.commit(async (tx) => {
            const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
            if (existing !== undefined) return existing.id;

            const created = await tx.createConversation({
                ownership: { kind: "task", taskId: api.taskId },
            });

            await configure(tx, created.id, {
                tools: [...options.tools],
                instructions:
                    "You are a rigorous, skeptical statistician and data auditor.\n" +
                    "Your mandate is to challenge analytical claims, detect confirmation bias, identify small sample sizes, " +
                    "spot confounding variables, and warn of Simpson's paradox.\n" +
                    "When data access is available, independently re-run or extend the evidence query (query_data, and " +
                    "discover_data for the source's naming) before issuing a verdict.\n" +
                    "Evaluate the finding strictly and return:\n" +
                    "1. VERDICT: [CONFIRMED | CAUTION | REJECTED]\n" +
                    "2. AUDIT REASONING: Detailed breakdown of statistical integrity\n" +
                    "3. REFINEMENT SUGGESTIONS: Specific improvements or boundary conditions.",
            });

            return created.id;
        }, context);

        // 3. Report subagent conversation ID for UI nesting
        await api.details({ conversationId: childConvId }, context);

        // 4. Submit audit request
        const subagent = await api.conversation(childConvId, context);
        if (!subagent) {
            throw new Error(`Failed to load auditor subagent conversation: ${childConvId}`);
        }

        const auditPrompt = [
            `Please audit the following analytical finding:`,
            `Title: ${finding.title}`,
            `Observation: ${finding.observation}`,
            `Claimed Impact: ${finding.impact}`,
            `Claimed Confidence: ${finding.confidence}`,
            `Evidence Query: ${finding.evidence.query ?? "N/A"}`,
            `Evidence Rationale: ${finding.evidence.rationale}`,
            `Actionable Recommendations: ${finding.actionableRecommendations.join("; ")}`,
        ].join("\n");

        const submission = await subagent.submit(
            {
                type: "input",
                content: auditPrompt,
                requestId: `audit:${api.taskId}:${args.findingId}`,
            },
            context,
        );

        const settled = await submission.wait(context);

        // 5. Read auditor answer
        const entry = await api.commit((tx) => tx.entry(AssistantEntry, settled.answer!), context);
        const message = entry?.model?.[0] as AssistantMessage | undefined;
        const auditReportText = message?.content
            ?.flatMap((c) => (c.type === "text" ? [c.text] : []))
            .join("") ?? "";

        const verdict = parseAuditVerdict(auditReportText);

        // 6. Update FindingsDoc atomically
        await api.commit(async (tx) => {
            const doc = await tx.doc(FindingsDoc, api.conversationId);
            const targetFinding = doc.findings.find((f) => f.id === args.findingId);
            if (targetFinding) {
                targetFinding.audited = true;
                targetFinding.auditVerdict = verdict;
                targetFinding.auditNotes = auditReportText;
                doc.updatedAt = Date.now();
            }
        }, context);

        api.output(`Auditor completed review: Verdict is ${verdict.toUpperCase()}.\n`);

        return {
            output: [
                {
                    type: "text",
                    text: `### Auditor Review Report for [${args.findingId}]\n**Verdict**: ${verdict.toUpperCase()}\n\n${auditReportText}`,
                },
            ],
        };
    },
});
}
