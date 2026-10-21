import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAnalystHarness } from "../src/harness";
import { parseAuditVerdict } from "../src/subagents/auditor-subagent";
import type { AnalystPlanDocument } from "../src/docs/plan";
import type { FindingsDocument } from "../src/docs/findings";

describe("tool results reach the model", () => {
    test("the model sees query rows, not just the progress line", async () => {
        const seen: string[] = [];
        const faux = fauxProvider({ provider: "faux", models: [{ id: "probe" }] });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("load_dataset", { filePath: "sample-data/customer_churn.csv" }), { stopReason: "toolUse" }),
            fauxAssistantMessage(
                fauxToolCall("query_data", {
                    sql: "SELECT plan_tier, COUNT(*) AS n FROM data GROUP BY plan_tier ORDER BY plan_tier",
                    rationale: "count accounts per tier",
                }),
                { stopReason: "toolUse" },
            ),
            (context) => {
                for (const message of context.messages) {
                    if (message.role !== "toolResult") continue;
                    seen.push(message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""));
                }
                return fauxAssistantMessage("done");
            },
        ]);

        const projectRoot = await mkdtemp(join(tmpdir(), "dataclaw-tool-output-"));
        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "probe" },
            projectRoot,
            workspaceDir: join(projectRoot, "workspace"),
        });
        try {
            await analyst.conversation.submit({ type: "input", content: "count tiers", requestId: "probe" }, analyst.context);
            await analyst.conversation.waitForIdle(analyst.context);
        } finally {
            await analyst.close();
            await rm(projectRoot, { recursive: true, force: true });
        }

        expect(seen).toHaveLength(2);
        expect(seen[0]).toContain("Total Rows: 40");
        expect(seen[1]).toContain("| Basic | 14 |");
    });
});

describe("parseAuditVerdict", () => {
    test("reads the VERDICT line, including markdown emphasis", () => {
        expect(parseAuditVerdict("1. VERDICT: REJECTED\n2. AUDIT REASONING: n=3")).toBe("rejected");
        expect(parseAuditVerdict("**VERDICT**: Caution")).toBe("caution");
        expect(parseAuditVerdict("VERDICT: CONFIRMED. Not rejected on any count.")).toBe("confirmed");
    });

    test("an unreadable audit is caution, never confirmed", () => {
        expect(parseAuditVerdict("")).toBe("caution");
        expect(parseAuditVerdict("Looks fine to me.")).toBe("caution");
    });
});

describe("optional tool arguments", () => {
    test("record_finding and manage_hypotheses accept a call without their optional fields", async () => {
        const faux = fauxProvider({ provider: "faux", models: [{ id: "probe" }] });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("manage_hypotheses", { action: "propose", title: "Basic tier churns more" }), { stopReason: "toolUse" }),
            fauxAssistantMessage(
                fauxToolCall("record_finding", {
                    title: "Basic churn",
                    observation: "Basic churns at 71%",
                    impact: "high",
                    confidence: 0.7,
                    rationale: "tier aggregate",
                    recommendations: [],
                }),
                { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("done"),
        ]);
        const projectRoot = await mkdtemp(join(tmpdir(), "dataclaw-optional-"));
        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "probe" },
            projectRoot,
            workspaceDir: join(projectRoot, "workspace"),
        });
        try {
            await analyst.conversation.submit({ type: "input", content: "note it", requestId: "optional" }, analyst.context);
            await analyst.conversation.waitForIdle(analyst.context);
            expect(((await analyst.getPlan()) as AnalystPlanDocument | undefined)?.hypotheses.map((h) => h.title)).toEqual(["Basic tier churns more"]);
            expect(((await analyst.getFindings()) as FindingsDocument | undefined)?.findings.map((f) => f.title)).toEqual(["Basic churn"]);
        } finally {
            await analyst.close();
            await rm(projectRoot, { recursive: true, force: true });
        }
    });
});
