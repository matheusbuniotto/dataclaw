import { defineTask } from "@earendil-works/pi-durable";
import { PlaybookDoc } from "../docs/playbook";
import { TelemetryDoc } from "../docs/telemetry";
import { FindingsDoc } from "../docs/findings";

export interface AutoImprovementInput {
    focusDomain?: string;
}

export interface CandidateRule {
    domain: string;
    rule: string;
    source: "human_feedback" | "audit_discovery" | "reflection";
    confidence: number;
    rationale: string;
}

export type AutoImprovementState =
    | { phase: "scan_telemetry" }
    | { phase: "distill_rules"; candidates: CandidateRule[] }
    | { phase: "commit_upgrades"; candidates: CandidateRule[] };

export const AutoImprovementTask = defineTask<AutoImprovementInput, AutoImprovementState, string>({
    name: "analyst.auto_improvement",
    version: 1,
    initial: () => ({ phase: "scan_telemetry" }),
    phases: {
        scan_telemetry: async (task, runtime, context) => {
            console.log(`[AutoImprovementTask ${task.id}] Scanning telemetry and feedback records...`);

            const candidates: CandidateRule[] = [];

            // In Pi Durable tasks, runtime.commit allows state changes
            await runtime.commit(async (tx) => {
                // If the task has conversation context, scan docs
                if (task.conversationId) {
                    const telemetry = await tx.doc(TelemetryDoc, task.conversationId);
                    const findings = await tx.doc(FindingsDoc, task.conversationId);

                    // 1. Process human feedback
                    for (const record of telemetry.records) {
                        if (record.humanFeedback && (record.humanRating ?? 5) < 5) {
                            candidates.push({
                                domain: task.input.focusDomain ?? "general_analysis",
                                rule: `Incorporate reviewer guidance: "${record.humanFeedback}" into methodology.`,
                                source: "human_feedback",
                                confidence: 0.9,
                                rationale: `Human reviewer provided rating ${record.humanRating ?? "N/A"}/5 with direct feedback.`,
                            });
                        }

                        // Process self-reflections
                        if (record.proposedHeuristics && record.proposedHeuristics.length > 0) {
                            for (const heuristic of record.proposedHeuristics) {
                                candidates.push({
                                    domain: task.input.focusDomain ?? "methodology",
                                    rule: heuristic,
                                    source: "reflection",
                                    confidence: 0.85,
                                    rationale: "Self-reflection proposed this optimization during prior analysis session.",
                                });
                            }
                        }
                    }

                    // 2. Process audit corrections
                    for (const finding of findings.findings) {
                        if (finding.audited && (finding.auditVerdict === "caution" || finding.auditVerdict === "rejected")) {
                            candidates.push({
                                domain: "audit_guardrails",
                                rule: `Guard against audit issue in "${finding.title}": ${finding.auditNotes?.slice(0, 150) ?? "Scrutinize validity and sample sizes"}`,
                                source: "audit_discovery",
                                confidence: 0.95,
                                rationale: `Finding received ${finding.auditVerdict.toUpperCase()} verdict during audit pass.`,
                            });
                        }
                    }
                }

                // If no specific candidates were found in docs, generate a baseline refinement rule
                if (candidates.length === 0) {
                    candidates.push({
                        domain: task.input.focusDomain ?? "business_metrics",
                        rule: "Cross-validate high correlation signals against secondary confounding columns before asserting causation.",
                        source: "reflection",
                        confidence: 0.9,
                        rationale: "Periodic baseline heuristic synthesis.",
                    });
                }

                return {
                    status: "running",
                    checkpoint: { phase: "distill_rules", candidates },
                };
            }, context);
        },

        distill_rules: async (task, runtime, context) => {
            const { candidates } = task.state.checkpoint as { phase: "distill_rules"; candidates: CandidateRule[] };
            console.log(`[AutoImprovementTask ${task.id}] Distilling ${candidates.length} candidate rules...`);

            // Deduplicate rules by normalized text
            const seen = new Set<string>();
            const uniqueCandidates: CandidateRule[] = [];

            for (const c of candidates) {
                const norm = c.rule.toLowerCase().trim();
                if (!seen.has(norm)) {
                    seen.add(norm);
                    uniqueCandidates.push(c);
                }
            }

            await runtime.commit(() => ({
                status: "running",
                checkpoint: { phase: "commit_upgrades", candidates: uniqueCandidates },
            }), context);
        },

        commit_upgrades: async (task, runtime, context) => {
            const { candidates } = task.state.checkpoint as { phase: "commit_upgrades"; candidates: CandidateRule[] };
            console.log(`[AutoImprovementTask ${task.id}] Committing ${candidates.length} upgrades to PlaybookDoc...`);

            let newVersion = 1;
            const addedRules: string[] = [];

            await runtime.commit(async (tx) => {
                if (task.conversationId) {
                    const playbook = await tx.doc(PlaybookDoc, task.conversationId);
                    playbook.version += 1;
                    newVersion = playbook.version;

                    for (const candidate of candidates) {
                        const ruleId = `rule-v${newVersion}-${playbook.heuristics.length + 1}`;
                        playbook.heuristics.push({
                            id: ruleId,
                            domain: candidate.domain,
                            rule: candidate.rule,
                            source: candidate.source,
                            confidence: candidate.confidence,
                            timesApplied: 0,
                            createdTimestamp: Date.now(),
                        });
                        addedRules.push(`[${ruleId}] ${candidate.rule}`);
                    }

                    playbook.improvementLog.push({
                        timestamp: Date.now(),
                        reason: `AutoImprovementTask execution (${candidates.length} rules synthesized)`,
                        addedHeuristicIds: addedRules.map((r) => r.split(" ")[0] ?? "").filter(Boolean),
                        notes: `Upgraded playbook from v${newVersion - 1} to v${newVersion}`,
                    });

                    playbook.lastImprovedAt = Date.now();
                }

                return {
                    status: "terminal",
                    outcome: {
                        status: "completed",
                        result: [
                            `### Auto-Improvement Cycle Complete!`,
                            `**Playbook Version**: Upgraded to Version ${newVersion}`,
                            `**New Rules Distilled**: ${candidates.length}`,
                            ...addedRules.map((r) => `- ${r}`),
                            `These rules are now dynamically active in the agent's system prompt!`,
                        ].join("\n"),
                    },
                };
            }, context);
        },
    },
    abort: async (task, runtime, context) => {
        console.log(`[AutoImprovementTask ${task.id}] Aborted.`);
        await runtime.commit(() => ({
            status: "terminal",
            outcome: { status: "aborted" },
        }), context);
    },
});
