/**
 * The one writer for document mutations that carry an invariant.
 *
 * Finding ids are allocated here, so a tool call and a workflow saga cannot invent the same one.
 * A verdict is attached here, so `audited: true` only comes from an auditor report. The active
 * dataset has one canonical shape here, so every call site writes the same document fields.
 */
import type { ConversationId, Tx } from "@earendil-works/pi-durable";
import { FindingsDoc, isAuditVerdict, type AuditVerdict, type Finding, type FindingEvidence } from "./findings";
import { AnalystPlanDoc, type DatasetMeta, type Hypothesis } from "./plan";
import { isFindingId, isHypothesisId, type FindingId, type HypothesisId } from "../types/brands";

/** What a caller knows about a finding. Audit state is absent: recording one never audits it. */
export type NewFinding = {
    title: string;
    observation: string;
    impact: Finding["impact"];
    confidence: number;
    evidence: FindingEvidence;
    actionableRecommendations: string[];
    hypothesisId?: string;
};

/**
 * The next free id, from the highest existing `find-N`, not from the array length. Length is not
 * an id allocator: a saga appending `find-1` and `find-2` (or any deletion) makes it collide.
 */
export function nextFindingId(findings: readonly Finding[]): FindingId {
    let highest = 0;
    for (const finding of findings) {
        const match = /^find-(\d+)$/.exec(finding.id);
        if (match && match[1]) highest = Math.max(highest, Number(match[1]));
    }
    const candidate = `find-${highest + 1}`;
    if (!isFindingId(candidate)) {
        throw new Error(`Allocated finding id failed validation: ${candidate}`);
    }
    return candidate;
}

/** The next free hypothesis id, for the same reason as findings: a second saga run must not collide. */
export function nextHypothesisId(hypotheses: readonly Hypothesis[]): HypothesisId {
    let highest = 0;
    for (const hypothesis of hypotheses) {
        const match = /^hyp-(\d+)$/.exec(hypothesis.id);
        if (match && match[1]) highest = Math.max(highest, Number(match[1]));
    }
    const candidate = `hyp-${highest + 1}`;
    if (!isHypothesisId(candidate)) {
        throw new Error(`Allocated hypothesis id failed validation: ${candidate}`);
    }
    return candidate;
}

/** Append a finding as unaudited. Callers describe it; the writer owns the id and audit state. */
export async function appendFinding(
    tx: Tx,
    conversationId: ConversationId,
    input: NewFinding,
): Promise<Finding> {
    const findings = await tx.doc(FindingsDoc, conversationId);
    const finding: Finding = {
        id: nextFindingId(findings.findings),
        ...(input.hypothesisId !== undefined ? { hypothesisId: input.hypothesisId } : {}),
        title: input.title,
        observation: input.observation,
        impact: input.impact,
        confidence: input.confidence,
        evidence: { ...input.evidence },
        audited: false,
        actionableRecommendations: [...input.actionableRecommendations],
        discoveredAt: Date.now(),
    };
    findings.findings.push(finding);
    findings.updatedAt = Date.now();
    return finding;
}

/**
 * Read the verdict from the auditor's "VERDICT: X" line.
 * A reply without one is "caution": an unreadable audit must not confirm a finding.
 */
export function parseAuditVerdict(report: string): AuditVerdict {
    const match = /VERDICT\W*(CONFIRMED|CAUTION|REJECTED)\b/i.exec(report);
    const candidate = match?.[1]?.toLowerCase();
    return isAuditVerdict(candidate) ? candidate : "caution";
}

/**
 * Attach an audit result. This is the only writer of `audited`, `auditVerdict` and `auditNotes`.
 *
 * It takes the auditor's report, not a verdict string, and parses the verdict itself: a caller
 * cannot confirm a finding without a report whose VERDICT line says so.
 */
export async function recordAudit(
    tx: Tx,
    conversationId: ConversationId,
    findingId: string,
    report: string,
): Promise<Finding | undefined> {
    // An empty reply is not an audit: nothing is recorded, so the finding stays unaudited.
    if (!report.trim()) return undefined;
    const findings = await tx.doc(FindingsDoc, conversationId);
    const finding = findings.findings.find((candidate) => candidate.id === findingId);
    if (!finding) return undefined;

    finding.audited = true;
    finding.auditVerdict = parseAuditVerdict(report);
    finding.auditNotes = report;
    findings.updatedAt = Date.now();
    return finding;
}

/**
 * Record the plan's active dataset in one field order, omitting absent optional fields the same way
 * for every caller. Re-profiling the dataset already recorded keeps the file path a local load
 * wrote, so the profile and load call sites describe the same dataset identically.
 */
export async function recordActiveDataset(
    tx: Tx,
    conversationId: ConversationId,
    input: DatasetMeta,
): Promise<DatasetMeta> {
    const plan = await tx.doc(AnalystPlanDoc, conversationId);
    const previous = plan.activeDataset;
    const sourcePath = input.sourcePath
        ?? (previous?.name === input.name && previous.provider === input.provider ? previous.sourcePath : undefined);

    const dataset: DatasetMeta = {
        name: input.name,
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(sourcePath !== undefined ? { sourcePath } : {}),
        rowCount: input.rowCount,
        columns: [...input.columns],
        ...(input.profileSummary !== undefined ? { profileSummary: input.profileSummary } : {}),
    };
    plan.activeDataset = dataset;
    return dataset;
}
