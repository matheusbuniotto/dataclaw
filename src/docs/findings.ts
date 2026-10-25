import { defineDoc } from "@earendil-works/pi-durable";
import type { FindingId, HypothesisId } from "../types/brands";

/** JSON-safe by construction: a document must satisfy the durable store's JsonObject. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type FindingEvidence = {
    query?: string;
    metricName?: string;
    sampleResult?: JsonValue;
    rationale: string;
};

export type AuditVerdict = "confirmed" | "caution" | "rejected";

export function isAuditVerdict(val: unknown): val is AuditVerdict {
    return val === "confirmed" || val === "caution" || val === "rejected";
}

export type Finding = {
    id: FindingId | string;
    hypothesisId?: HypothesisId | string;
    title: string;
    observation: string;
    impact: "critical" | "high" | "medium" | "low";
    confidence: number; // 0.0 - 1.0
    evidence: FindingEvidence;
    audited: boolean;
    auditVerdict?: AuditVerdict;
    auditNotes?: string;
    actionableRecommendations: string[];
    discoveredAt: number;
};

export type FindingsDocument = {
    findings: Finding[];
    executiveSummary?: string;
    keyTakeaways: string[];
    updatedAt: number;
};

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
