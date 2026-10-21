import { defineDoc } from "@earendil-works/pi-durable";

export interface FindingEvidence {
    query?: string;
    metricName?: string;
    sampleResult?: Record<string, unknown> | Array<unknown>;
    rationale: string;
}

export interface Finding {
    id: string;
    hypothesisId?: string;
    title: string;
    observation: string;
    impact: "critical" | "high" | "medium" | "low";
    confidence: number; // 0.0 - 1.0
    evidence: FindingEvidence;
    audited: boolean;
    auditVerdict?: "confirmed" | "caution" | "rejected";
    auditNotes?: string;
    actionableRecommendations: string[];
    discoveredAt: number;
}

export interface FindingsDocument {
    findings: Finding[];
    executiveSummary?: string;
    keyTakeaways: string[];
    updatedAt: number;
}

export const FindingsDoc = defineDoc<FindingsDocument>({
    kind: "analyst.findings",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({
        findings: [],
        keyTakeaways: [],
        updatedAt: Date.now(),
    }),
});
