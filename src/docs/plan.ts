import { defineDoc, type JsonObject } from "@earendil-works/pi-durable";
import type { SourceRecord } from "../datasource/types";

export type Hypothesis = {
    id: string;
    title: string;
    description: string;
    status: "proposed" | "testing" | "validated" | "refuted" | "inconclusive";
    evidenceIds: string[];
    notes?: string;
    proposedAt: number;
    updatedAt: number;
};

/** The table the plan is working from, as the source names it. */
export type DatasetMeta = {
    name: string;
    /** Provider id it came from: `local` for a file loaded into SQLite, `databricks`, or a plugin id. */
    provider?: string;
    /** The file a local dataset was loaded from. */
    sourcePath?: string;
    rowCount: number;
    columns: string[];
    profileSummary?: string;
};

export type AnalystPlanDocument = {
    goal: string;
    status: "planning" | "investigating" | "auditing" | "synthesizing" | "completed" | "needs_review";
    activeDataset?: DatasetMeta;
    /** The live data source, written by the data-source session. Never holds a token. */
    dataSource?: SourceRecord;
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
};

/**
 * Version 1 stored a Databricks-shaped `databricks` record and a `source` discriminator on the
 * dataset. Version 2 stores the provider-neutral `dataSource` record and `DatasetMeta.provider`.
 * A token was never stored, so there is none to drop; a `warehouseId` was informational and goes.
 */
export function migratePlanDocument(value: JsonObject, fromVersion: number): AnalystPlanDocument {
    if (fromVersion >= 2) return value as unknown as AnalystPlanDocument;

    const legacy = value as Record<string, unknown>;
    const { databricks, ...rest } = legacy;
    const migrated: Record<string, unknown> = { ...rest };

    const connection = databricks as {
        host?: unknown;
        mcpUrl?: unknown;
        profile?: unknown;
        warehouseId?: unknown;
        connectedAt?: unknown;
    } | undefined;
    if (connection && typeof connection.connectedAt === "number") {
        migrated.dataSource = {
            provider: "databricks",
            dialect: "databricks",
            ...(typeof connection.host === "string" ? { host: connection.host } : {}),
            ...(typeof connection.mcpUrl === "string" ? { endpoint: connection.mcpUrl } : {}),
            ...(typeof connection.profile === "string"
                ? { credential: { kind: "cli-profile", profile: connection.profile } }
                : {}),
            connectedAt: connection.connectedAt,
        } satisfies SourceRecord;
    }

    const dataset = legacy.activeDataset as Record<string, unknown> | undefined;
    if (dataset) {
        const { source, catalog: _catalog, schema: _schema, ...fields } = dataset;
        migrated.activeDataset = {
            ...fields,
            ...(source === "databricks"
                ? { provider: "databricks" }
                : source === "file"
                    ? { provider: "local" }
                    : {}),
        };
    }

    return migrated as unknown as AnalystPlanDocument;
}

export const AnalystPlanDoc = defineDoc<AnalystPlanDocument>({
    kind: "analyst.plan",
    version: 2,
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
    migrate: (value, fromVersion) => migratePlanDocument(value, fromVersion),
});
