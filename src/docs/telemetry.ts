import { defineDoc } from "@earendil-works/pi-durable";

export interface TelemetryRecord {
    id: string;
    timestamp: number;
    workflowName: string;
    durationMs: number;
    hypothesesTested: number;
    findingsGenerated: number;
    humanRating?: number; // 1 to 5
    humanFeedback?: string;
    auditVerdict?: "confirmed" | "caution" | "rejected";
    auditCorrections: number;
    errorsEncountered: string[];
    reflectionNote?: string;
    proposedHeuristics?: string[];
}

export interface TelemetryDocument {
    records: TelemetryRecord[];
    averageRating?: number;
    totalRuns: number;
    totalFindings: number;
    updatedAt: number;
}

export const TelemetryDoc = defineDoc<TelemetryDocument>({
    kind: "analyst.telemetry",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({
        records: [],
        totalRuns: 0,
        totalFindings: 0,
        updatedAt: Date.now(),
    }),
});
