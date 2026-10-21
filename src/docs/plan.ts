import { defineDoc } from "@earendil-works/pi-durable";

export interface Hypothesis {
    id: string;
    title: string;
    description: string;
    status: "proposed" | "testing" | "validated" | "refuted" | "inconclusive";
    evidenceIds: string[];
    notes?: string;
    proposedAt: number;
    updatedAt: number;
}

export interface DatasetMeta {
    name: string;
    /** file = local CSV/JSON loaded into SQLite; databricks = Unity Catalog table. */
    source?: "file" | "databricks";
    sourcePath?: string;
    catalog?: string;
    schema?: string;
    rowCount: number;
    columns: string[];
    profileSummary?: string;
}

export interface DatabricksConnectionMeta {
    host: string;
    mcpUrl: string;
    profile?: string;
    warehouseId?: string;
    connectedAt: number;
}

export interface AnalystPlanDocument {
    goal: string;
    status: "planning" | "investigating" | "auditing" | "synthesizing" | "completed" | "needs_review";
    activeDataset?: DatasetMeta;
    /** Durable record of the active Databricks MCP connection (never stores the token). */
    databricks?: DatabricksConnectionMeta;
    currentMilestone: string;
    hypotheses: Hypothesis[];
    investigationSteps: Array<{
        id: string;
        description: string;
        completed: boolean;
        resultSummary?: string;
    }>;
    createdAt: number;
    updatedAt: number;
}

export const AnalystPlanDoc = defineDoc<AnalystPlanDocument>({
    kind: "analyst.plan",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({
        goal: "Pending goal definition",
        status: "planning",
        currentMilestone: "Intake and Data Profiling",
        hypotheses: [],
        investigationSteps: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }),
});
