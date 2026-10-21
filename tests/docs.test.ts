import { expect, test, describe } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AnalystPlanDoc } from "../src/docs/plan";
import { FindingsDoc } from "../src/docs/findings";
import { PlaybookDoc } from "../src/docs/playbook";
import { TelemetryDoc } from "../src/docs/telemetry";

describe("Durable Documents", () => {
    test("mutates and reads AnalystPlanDoc, FindingsDoc, and PlaybookDoc", async () => {
        const context = BACKGROUND_CONTEXT;
        const faux = fauxProvider({
            provider: "faux",
            models: [{ id: "test-model" }],
        });
        faux.setResponses([fauxAssistantMessage("Hello")]);

        const models = createModels();
        models.setProvider(faux.provider);

        const registry = createRegistry();
        const env = () => new NodeExecutionEnv({ cwd: process.cwd() });
        const storage = await openNodeSqliteStorage(":memory:");

        const harness = await Harness.open(storage, { models, registry, env }, context);
        const root = await harness.root(context, {
            agent: { model: { provider: "faux", modelId: "test-model" } },
        });

        // Mutate PlanDoc
        await root.commit(async (tx) => {
            const plan = await tx.doc(AnalystPlanDoc, root.id);
            plan.goal = "Test Goal";
            plan.hypotheses.push({
                id: "h1",
                title: "Hypothesis 1",
                description: "Test description",
                status: "validated",
                evidenceIds: [],
                proposedAt: Date.now(),
                updatedAt: Date.now(),
            });
        }, context);

        const planState = await harness.documentState(AnalystPlanDoc, root.id, context);
        expect(planState?.value?.goal).toBe("Test Goal");
        expect(planState?.value?.hypotheses.length).toBe(1);

        // Mutate FindingsDoc
        await root.commit(async (tx) => {
            const findings = await tx.doc(FindingsDoc, root.id);
            findings.findings.push({
                id: "f1",
                title: "Finding 1",
                observation: "High churn observed",
                impact: "high",
                confidence: 0.9,
                evidence: { rationale: "Data test" },
                audited: true,
                auditVerdict: "confirmed",
                actionableRecommendations: ["Fix bug"],
                discoveredAt: Date.now(),
            });
        }, context);

        const findingsState = await harness.documentState(FindingsDoc, root.id, context);
        expect(findingsState?.value?.findings.length).toBe(1);
        expect(findingsState?.value?.findings[0].auditVerdict).toBe("confirmed");

        // Mutate PlaybookDoc
        await root.commit(async (tx) => {
            const playbook = await tx.doc(PlaybookDoc, root.id);
            playbook.version += 1;
            playbook.heuristics.push({
                id: "h-new",
                domain: "testing",
                rule: "New learned rule",
                source: "reflection",
                confidence: 0.9,
                timesApplied: 0,
                createdTimestamp: Date.now(),
            });
        }, context);

        const playbookState = await harness.documentState(PlaybookDoc, root.id, context);
        expect(playbookState?.value?.version).toBe(2);
        expect(playbookState?.value?.heuristics.some((h) => h.id === "h-new")).toBe(true);

        await harness.close(context);
    });
});
