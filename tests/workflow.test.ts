import { expect, test, describe } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createAnalystTools } from "../src/extensions/analyst-extension";
import { AnalysisWorkflowTask } from "../src/tasks/analysis-workflow";
import { AnalystPlanDoc } from "../src/docs/plan";
import { FindingsDoc } from "../src/docs/findings";

describe("AnalysisWorkflowTask", () => {
    test("executes end-to-end analytical workflow saga", async () => {
        const context = BACKGROUND_CONTEXT;
        const faux = fauxProvider({
            provider: "faux",
            models: [{ id: "test-model" }],
        });
        faux.setResponses([fauxAssistantMessage("Workflow completed.")]);

        const models = createModels();
        models.setProvider(faux.provider);

        const registry = createRegistry();
        registry.install(createAnalystTools({
            sessions: () => {
                throw new Error("the workflow test does not use data tools");
            },
        }));

        const env = () => new NodeExecutionEnv({ cwd: process.cwd() });
        const storage = await openNodeSqliteStorage(":memory:");

        const harness = await Harness.open(storage, { models, registry, env }, context);
        const root = await harness.root(context, {
            agent: { model: { provider: "faux", modelId: "test-model" } },
        });

        // Initialize documents
        await root.commit(async (tx) => {
            await tx.doc(AnalystPlanDoc, root.id);
            await tx.doc(FindingsDoc, root.id);
        }, context);

        const taskId = await root.commit(async (tx) => {
            return await tx.createTask(
                AnalysisWorkflowTask,
                {
                    filePath: "./sample-data/customer_churn.csv",
                    targetQuestion: "Analyze churn drivers among tier cohorts",
                },
                { ownership: { kind: "conversation" } },
            );
        }, context);

        const outcome = await harness.waitForTask(taskId, context);
        expect(outcome.state.outcome.status).toBe("completed");

        // Verify AnalystPlanDoc was populated and marked completed
        const plan = await harness.documentState(AnalystPlanDoc, root.id, context);
        expect(plan?.value?.status).toBe("completed");
        expect(plan?.value?.hypotheses.length).toBeGreaterThan(0);
        expect(plan?.value?.hypotheses[0]?.status).toBe("validated");

        // Verify FindingsDoc has verified findings
        const findings = await harness.documentState(FindingsDoc, root.id, context);
        expect(findings?.value?.findings.length).toBeGreaterThanOrEqual(2);
        // The saga records findings but never audits them: only request_auditor_review confirms.
        expect(findings?.value?.findings[0]?.audited).toBe(false);
        expect(findings?.value?.findings[0]?.auditVerdict).toBeUndefined();
        expect(findings?.value?.executiveSummary).toBeDefined();

        await harness.close(context);
    });
});
