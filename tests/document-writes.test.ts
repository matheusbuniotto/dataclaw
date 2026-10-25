import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, type ConversationId, type Tx } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createAnalystTools } from "../src/extensions/analyst-extension";
import { FindingsDoc, type Finding, type FindingsDocument } from "../src/docs/findings";
import { AnalystPlanDoc, type AnalystPlanDocument } from "../src/docs/plan";
import {
    appendFinding,
    nextFindingId,
    parseAuditVerdict,
    recordActiveDataset,
    recordAudit,
} from "../src/docs/writers";
import { AnalysisWorkflowTask } from "../src/tasks/analysis-workflow";

const finding = (id: string): Finding => ({
    id,
    title: "t",
    observation: "o",
    impact: "high",
    confidence: 0.9,
    evidence: { rationale: "r" },
    audited: false,
    actionableRecommendations: [],
    discoveredAt: 0,
});

/** A transaction stub that hands back the same document objects the writers mutate. */
function stubTx(): { tx: Tx; findings: FindingsDocument; plan: AnalystPlanDocument } {
    const findings: FindingsDocument = { findings: [], keyTakeaways: [], updatedAt: 0 };
    const plan: AnalystPlanDocument = { goal: "g", status: "planning", hypotheses: [], currentMilestone: "", investigationSteps: [], createdAt: 0, updatedAt: 0 };
    const docs = new Map<unknown, unknown>([
        [FindingsDoc, findings],
        [AnalystPlanDoc, plan],
    ]);
    const tx = {
        doc: async (kind: unknown) => docs.get(kind),
    } as unknown as Tx;
    return { tx, findings, plan };
}

const CID = "c1" as unknown as ConversationId;

describe("the document writers", () => {
    test("finding ids come from the highest existing id, not the array length", () => {
        expect(String(nextFindingId([]))).toBe("find-1");
        expect(String(nextFindingId([finding("find-1")]))).toBe("find-2");
        // Two findings with a gap (a deletion, a saga run) must not collide with find-3.
        expect(String(nextFindingId([finding("find-2"), finding("find-7"), finding("legacy")]))).toBe("find-8");
    });

    test("appendFinding allocates the id and never audits", async () => {
        const { tx, findings } = stubTx();
        const first = await appendFinding(tx, CID, {
            title: "Tickets predict churn",
            observation: "r = 0.9",
            impact: "critical",
            confidence: 0.95,
            evidence: { rationale: "correlation" },
            actionableRecommendations: ["call the customer"],
        });
        const second = await appendFinding(tx, CID, {
            title: "Basic churns more",
            observation: "12% vs 3%",
            impact: "high",
            confidence: 0.92,
            evidence: { rationale: "cohort" },
            actionableRecommendations: [],
        });

        expect([first.id, second.id]).toEqual(["find-1", "find-2"]);
        expect(findings.findings.every((item) => item.audited === false)).toBe(true);
        expect(findings.findings.every((item) => item.auditVerdict === undefined)).toBe(true);
    });

    test("recordAudit is the only path to audited:true, and it parses the report", async () => {
        const { tx } = stubTx();
        await appendFinding(tx, CID, {
            title: "t",
            observation: "o",
            impact: "high",
            confidence: 0.9,
            evidence: { rationale: "r" },
            actionableRecommendations: [],
        });

        const confirmed = await recordAudit(tx, CID, "find-1", "1. VERDICT: CONFIRMED\n2. AUDIT REASONING: n=40");
        expect(confirmed?.audited).toBe(true);
        expect(confirmed?.auditVerdict).toBe("confirmed");
        expect(confirmed?.auditNotes).toContain("VERDICT: CONFIRMED");

        // An unreadable audit must not confirm: the parser's default is caution.
        expect(parseAuditVerdict("Looks fine to me.")).toBe("caution");
        expect(await recordAudit(tx, CID, "find-404", "VERDICT: CONFIRMED")).toBeUndefined();
    });

    test("recordActiveDataset writes one shape and keeps the local path across a re-profile", async () => {
        const { tx } = stubTx();
        const loaded = await recordActiveDataset(tx, CID, {
            name: "customers",
            provider: "local",
            sourcePath: "/data/customers.csv",
            rowCount: 10,
            columns: ["id", "churned"],
            profileSummary: "10 rows",
        });
        const profiled = await recordActiveDataset(tx, CID, {
            name: "customers",
            provider: "local",
            rowCount: 10,
            columns: ["id", "churned"],
            profileSummary: "10 rows",
        });

        expect(loaded).toEqual(profiled);
        // Optional fields are omitted, never written as undefined.
        expect(Object.keys(profiled)).toEqual(["name", "provider", "sourcePath", "rowCount", "columns", "profileSummary"]);
    });
});

describe("the saga goes through the writers", () => {
    test("running it twice appends fresh ids and never confirms", async () => {
        const context = BACKGROUND_CONTEXT;
        const faux = fauxProvider({ provider: "faux", models: [{ id: "test-model" }] });
        faux.setResponses([fauxAssistantMessage("Workflow completed.")]);
        const models = createModels();
        models.setProvider(faux.provider);

        const registry = createRegistry();
        registry.install(createAnalystTools({
            sessions: () => {
                throw new Error("the workflow test does not use data tools");
            },
        }));

        const storage = await openNodeSqliteStorage(":memory:");
        const harness = await Harness.open(storage, {
            models,
            registry,
            env: () => new NodeExecutionEnv({ cwd: process.cwd() }),
        }, context);
        const root = await harness.root(context, {
            agent: { model: { provider: "faux", modelId: "test-model" } },
        });
        await root.commit(async (tx) => {
            await tx.doc(AnalystPlanDoc, root.id);
            await tx.doc(FindingsDoc, root.id);
        }, context);

        for (let run = 0; run < 2; run++) {
            const taskId = await root.commit((tx) => tx.createTask(
                AnalysisWorkflowTask,
                {
                    filePath: "./sample-data/customer_churn.csv",
                    targetQuestion: "Analyze churn drivers among tier cohorts",
                },
                { ownership: { kind: "conversation" } },
            ), context);
            const outcome = await harness.waitForTask(taskId, context);
            expect(outcome.state.outcome.status).toBe("completed");
        }

        const plan = (await harness.documentState(AnalystPlanDoc, root.id, context))?.value;
        // The saga writes the dataset through the one writer, and hypothesis ids cannot collide.
        expect(plan?.activeDataset).toMatchObject({
            name: "data",
            provider: "local",
            sourcePath: "./sample-data/customer_churn.csv",
        });
        expect(plan?.activeDataset?.profileSummary).toBeDefined();
        const hypothesisIds = (plan?.hypotheses ?? []).map((hypothesis) => hypothesis.id);
        expect(new Set(hypothesisIds).size).toBe(hypothesisIds.length);

        const findings = ((await harness.documentState(FindingsDoc, root.id, context))?.value?.findings ?? []) as Finding[];
        expect(findings.length).toBeGreaterThanOrEqual(4);
        expect(new Set(findings.map((item) => item.id)).size).toBe(findings.length);
        expect(findings.some((item) => item.audited || item.auditVerdict !== undefined)).toBe(false);

        await harness.close(context);
    }, 60_000);
});
