/**
 * Version 1 → 2 of `AnalystPlanDoc`. The migration is a pure function so it is testable without
 * opening storage with an old document.
 */
import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@earendil-works/pi-durable";
import { migratePlanDocument, type AnalystPlanDocument } from "../src/docs/plan";
import { databricksRecord } from "../src/datasource/providers/databricks";

const HOST = "dbc-1234.cloud.databricks.com";
const MCP_URL = `https://${HOST}/api/2.0/mcp/sql`;

function v1(extra: Record<string, unknown> = {}): JsonObject {
    return {
        goal: "Why is Basic tier churning?",
        status: "investigating",
        currentMilestone: "Data Exploration",
        hypotheses: [],
        investigationSteps: [],
        createdAt: 1,
        updatedAt: 2,
        databricks: {
            host: HOST,
            mcpUrl: MCP_URL,
            profile: "DEFAULT",
            warehouseId: "abc123",
            connectedAt: 123,
        },
        activeDataset: {
            name: "samples.nyctaxi.trips",
            source: "databricks",
            catalog: "samples",
            schema: "nyctaxi",
            rowCount: 21932,
            columns: ["trip_distance", "fare_amount"],
            profileSummary: "### Profile",
        },
        ...extra,
    } as JsonObject;
}

describe("plan document v1 → v2", () => {
    test("turns the Databricks record into the provider-neutral one, keeping connectedAt", () => {
        const migrated = migratePlanDocument(v1(), 1) as Record<string, any>;

        expect(migrated.databricks).toBeUndefined();
        expect(migrated.dataSource).toEqual(databricksRecord({
            host: HOST,
            mcpUrl: MCP_URL,
            profile: "DEFAULT",
            connectedAt: 123,
        }));
        expect(migrated.dataSource).toEqual({
            provider: "databricks",
            dialect: "databricks",
            host: HOST,
            endpoint: MCP_URL,
            credential: { kind: "cli-profile", profile: "DEFAULT" },
            connectedAt: 123,
        });
    });

    test("drops the informational warehouse id and keeps every other plan field", () => {
        const migrated = migratePlanDocument(v1(), 1) as Record<string, any>;
        expect(JSON.stringify(migrated)).not.toContain("warehouseId");
        expect(migrated.goal).toBe("Why is Basic tier churning?");
        expect(migrated.status).toBe("investigating");
        expect(migrated.createdAt).toBe(1);
    });

    test("replaces the dataset's source discriminator with a provider", () => {
        const migrated = migratePlanDocument(v1(), 1) as Record<string, any>;
        expect(migrated.activeDataset).toEqual({
            name: "samples.nyctaxi.trips",
            rowCount: 21932,
            columns: ["trip_distance", "fare_amount"],
            profileSummary: "### Profile",
            provider: "databricks",
        });
    });

    test("maps a file dataset to the local provider", () => {
        const migrated = migratePlanDocument(v1({
            databricks: undefined,
            activeDataset: {
                name: "data",
                source: "file",
                sourcePath: "sample-data/customer_churn.csv",
                rowCount: 10,
                columns: ["plan_tier"],
            },
        }), 1) as Record<string, any>;

        expect(migrated.dataSource).toBeUndefined();
        expect(migrated.activeDataset).toEqual({
            name: "data",
            sourcePath: "sample-data/customer_churn.csv",
            rowCount: 10,
            columns: ["plan_tier"],
            provider: "local",
        });
    });

    test("a plan with neither a connection nor a dataset migrates to itself", () => {
        const bare = v1({ databricks: undefined, activeDataset: undefined });
        const migrated = migratePlanDocument(bare, 1) as Record<string, any>;
        expect(migrated.dataSource).toBeUndefined();
        expect(migrated.activeDataset).toBeUndefined();
        expect(migrated.goal).toBe("Why is Basic tier churning?");
    });

    test("leaves a version-2 document untouched", () => {
        const current = {
            goal: "x",
            dataSource: databricksRecord({ host: HOST, connectedAt: 9 }),
        } as unknown as AnalystPlanDocument;
        expect(migratePlanDocument(current, 2)).toBe(current);
    });

    test("migrating twice is the same as migrating once", () => {
        const once = migratePlanDocument(v1(), 1);
        expect(migratePlanDocument(once, 2)).toEqual(once);
    });
});
