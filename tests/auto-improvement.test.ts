import { expect, test, describe } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AutoImprovementTask } from "../src/tasks/auto-improvement";
import { PlaybookDoc } from "../src/docs/playbook";
import { TelemetryDoc } from "../src/docs/telemetry";

describe("AutoImprovementTask", () => {
    test("scans telemetry feedback and upgrades PlaybookDoc version with distilled rules", async () => {
        const context = BACKGROUND_CONTEXT;
        const faux = fauxProvider({
            provider: "faux",
            models: [{ id: "test-model" }],
        });
        faux.setResponses([fauxAssistantMessage("Ready")]);

        const models = createModels();
        models.setProvider(faux.provider);

        const registry = createRegistry();
        registry.install({
            name: "test-auto-improve",
            tasks: [AutoImprovementTask],
        });
        const env = () => new NodeExecutionEnv({ cwd: process.cwd() });
        const storage = await openNodeSqliteStorage(":memory:");

        const harness = await Harness.open(storage, { models, registry, env }, context);
        const root = await harness.root(context, {
            agent: { model: { provider: "faux", modelId: "test-model" } },
        });

        // Initialize documents in root conversation
        await root.commit(async (tx) => {
            await tx.doc(PlaybookDoc, root.id);
            await tx.doc(TelemetryDoc, root.id);
        }, context);

        // Seed initial telemetry record with human feedback
        await root.commit(async (tx) => {
            const telemetry = await tx.doc(TelemetryDoc, root.id);
            telemetry.records.push({
                id: "tel-1",
                timestamp: Date.now(),
                workflowName: "churn_analysis",
                durationMs: 1200,
                hypothesesTested: 2,
                findingsGenerated: 1,
                humanRating: 2,
                humanFeedback: "Must segment accounts by annual vs monthly contract before calculating churn rate.",
                reflectionNote: "Unsegmented churn rate confounded annual and monthly customer behaviors.",
                proposedHeuristics: ["Always cross-tabulate contract_type when reporting retention."],
                auditCorrections: 1,
                errorsEncountered: [],
            });
        }, context);

        // Verify baseline playbook is v1
        const initialPlaybook = await harness.documentState(PlaybookDoc, root.id, context);
        expect(initialPlaybook?.value?.version).toBe(1);
        const initialCount = initialPlaybook?.value?.heuristics.length ?? 0;

        // Launch AutoImprovementTask
        const taskId = await root.commit(async (tx) => {
            return await tx.createTask(
                AutoImprovementTask,
                { focusDomain: "contract_segmentation" },
                { ownership: { kind: "conversation" } },
            );
        }, context);

        const taskResult = await harness.waitForTask(taskId, context);
        expect(taskResult.state.outcome.status).toBe("completed");

        // Verify Playbook was upgraded to v2 and contains the new heuristic
        const upgradedPlaybook = await harness.documentState(PlaybookDoc, root.id, context);
        expect(upgradedPlaybook?.value?.version).toBe(2);
        expect(upgradedPlaybook?.value?.heuristics.length).toBeGreaterThan(initialCount);

        const hasLearnedRule = upgradedPlaybook?.value?.heuristics.some(
            (h) => h.rule.includes("Always cross-tabulate contract_type") || h.rule.includes("Must segment accounts")
        );
        expect(hasLearnedRule).toBe(true);
        expect(upgradedPlaybook?.value?.improvementLog.length).toBe(1);

        await harness.close(context);
    });
});
