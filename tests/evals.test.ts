import { describe, expect, test } from "bun:test";
import {
    chiSquarePValue,
    clusterBootstrap,
    cohensH,
    cohensKappa,
    proportionDifference,
    sampleRatioMismatch,
    wilson,
} from "../evals/stats";
import { EVAL_TASKS, answerLine, expectedAnswer, grade } from "../evals/tasks";
import { assessStuck, extractTrace } from "../evals/trace";
import { auditedItems, parseCsv, score, toCsv } from "../evals/calibrate";
import { runEpisode, type EpisodeResult } from "../evals/run";
import { SCRIPTED_VARIANTS } from "../evals/scripted-agent";

const task = (id: string) => EVAL_TASKS.find((t) => t.id === id)!;

describe("stats", () => {
    test("Cohen's kappa matches the textbook 2x2 case", () => {
        // 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no: po = 0.7, pe = 0.5, kappa = 0.4
        const a = [...Array(25).fill("yes"), ...Array(25).fill("no")];
        const b = [...Array(20).fill("yes"), ...Array(5).fill("no"), ...Array(10).fill("yes"), ...Array(15).fill("no")];
        expect(cohensKappa(a, b)).toBeCloseTo(0.4, 10);
        expect(cohensKappa(a, a)).toBe(1);
    });

    test("chi-square p-values hit the familiar critical values", () => {
        expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
        expect(chiSquarePValue(10.828, 1)).toBeCloseTo(0.001, 4);
        expect(chiSquarePValue(5.991, 2)).toBeCloseTo(0.05, 3);
    });

    test("SRM flags a lopsided split and passes a fair one", () => {
        expect(sampleRatioMismatch([5000, 5000], [1, 1]).mismatch).toBe(false);
        const skewed = sampleRatioMismatch([5000, 4600], [1, 1]);
        expect(skewed.mismatch).toBe(true);
        expect(skewed.pValue).toBeLessThan(0.001);
    });

    test("Wilson and Newcombe intervals match published examples", () => {
        const w = wilson(8, 10);
        expect(w.low).toBeCloseTo(0.4902, 3);
        expect(w.high).toBeCloseTo(0.9433, 3);
        // Newcombe (1998), example (a): 56/70 vs 48/80 -> 0.2 [0.0524, 0.3339]
        const d = proportionDifference(48, 80, 56, 70);
        expect(d.estimate).toBeCloseTo(0.2, 10);
        expect(d.low).toBeCloseTo(0.0524, 3);
        expect(d.high).toBeCloseTo(0.3339, 3);
    });

    test("Cohen's h is zero for equal rates and signed by direction", () => {
        expect(cohensH(0.5, 0.5)).toBe(0);
        expect(cohensH(0.2, 0.5)).toBeCloseTo(0.6435, 3);
        expect(cohensH(0.5, 0.2)).toBeCloseTo(-0.6435, 3);
    });

    test("cluster bootstrap is deterministic for a seed and brackets the estimate", () => {
        const clusters = [[1, 1, 0], [0, 0, 0], [1, 1, 1], [1, 0, 1]];
        const avg = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
        const first = clusterBootstrap(clusters, avg, { seed: 5 });
        expect(clusterBootstrap(clusters, avg, { seed: 5 })).toEqual(first);
        expect(first.low).toBeLessThanOrEqual(first.estimate);
        expect(first.high).toBeGreaterThanOrEqual(first.estimate);
    });
});

describe("tasks and grading", () => {
    test("reference answers come from the data", async () => {
        expect(await expectedAnswer(task("churn-basic-tier"))).toBeCloseTo(10 / 14, 10);
        expect(await expectedAnswer(task("incidents-billing-users"))).toBe(2310);
        expect(await expectedAnswer(task("incidents-longest"))).toBe("INC-105");
    });

    test("grading reads the ANSWER line and accepts percentages", () => {
        const t = task("churn-basic-tier");
        expect(grade(t, 0.7142857, "ANSWER: 0.714")).toBe(true);
        expect(grade(t, 0.7142857, "ANSWER: 71.4%")).toBe(true);
        expect(grade(t, 0.7142857, "ANSWER: 71.4")).toBe(true);
        expect(grade(t, 0.7142857, "ANSWER: 0.65")).toBe(false);
        expect(grade(t, 0.7142857, "The rate is 0.714")).toBe(false);
        expect(grade(task("incidents-billing-users"), 2310, "ANSWER: 2,310 users")).toBe(true);
        expect(grade(task("incidents-longest"), "INC-105", "ANSWER: inc-105")).toBe(true);
        expect(grade(task("incidents-longest"), "INC-105", "ANSWER: INC-1050")).toBe(false);
        expect(answerLine("ANSWER: 1\nwait\nANSWER: 2")).toBe("2");
    });
});

const call = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, name: string, text: string, isError = false) =>
    ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError });

describe("trace and stuck detection", () => {
    test("a clean run is not stuck", () => {
        const trace = extractTrace([
            { role: "user", content: "q" },
            { role: "assistant", content: [call("1", "profile_dataset", { filePath: "a.csv" })], stopReason: "toolUse" },
            result("1", "profile_dataset", "ok"),
            { role: "assistant", content: [{ type: "text", text: "ANSWER: 3" }], stopReason: "stop" },
        ]);
        expect(trace.toolCalls).toHaveLength(1);
        expect(trace.finalText).toBe("ANSWER: 3");
        expect(assessStuck(trace)).toMatchObject({ stuck: false, reasons: [] });
    });

    test("identical calls are a loop regardless of argument key order", () => {
        const messages: unknown[] = [{ role: "user", content: "q" }];
        for (let i = 0; i < 3; i++) {
            const args = i % 2 ? { rationale: "r", sql: "SELECT 1" } : { sql: "SELECT 1", rationale: "r" };
            messages.push({ role: "assistant", content: [call(`c${i}`, "run_analytical_query", args)], stopReason: "toolUse" });
            messages.push(result(`c${i}`, "run_analytical_query", "| 1 |"));
        }
        messages.push({ role: "assistant", content: [{ type: "text", text: "ANSWER: 1" }], stopReason: "stop" });
        const stuck = assessStuck(extractTrace(messages));
        expect(stuck.reasons).toEqual(["repeated_call"]);
        expect(stuck.maxRepeats).toBe(3);
    });

    test("an error streak and a missing answer are both reported", () => {
        const messages: unknown[] = [{ role: "user", content: "q" }];
        for (let i = 0; i < 3; i++) {
            messages.push({ role: "assistant", content: [call(`e${i}`, "run_analytical_query", { sql: `SELEC ${i}` })], stopReason: "toolUse" });
            messages.push(result(`e${i}`, "run_analytical_query", "SQL Execution Error", true));
        }
        messages.push({ role: "assistant", content: [], stopReason: "aborted" });
        const stuck = assessStuck(extractTrace(messages));
        expect(stuck.reasons).toEqual(["error_streak", "no_final_answer"]);
        expect(stuck.longestErrorStreak).toBe(3);
    });

    test("a call that never got a result counts as an error", () => {
        const trace = extractTrace([{ role: "assistant", content: [call("x", "query_databricks", {})], stopReason: "toolUse" }]);
        expect(trace.toolCalls[0]!.isError).toBe(true);
    });

    test("answering after a rejected finding is flagged unless a revision followed", () => {
        const base = extractTrace([{ role: "assistant", content: [{ type: "text", text: "ANSWER: 1" }], stopReason: "stop" }]);
        const rejected = { id: "find-1", title: "t", observation: "o", auditVerdict: "rejected" as const };
        const revised = { id: "find-2", title: "t", observation: "o", query: "q", auditVerdict: "confirmed" as const };
        expect(assessStuck({ ...base, findings: [rejected] }).shippedRejectedFinding).toBe(true);
        expect(assessStuck({ ...base, findings: [rejected, revised] }).shippedRejectedFinding).toBe(false);
    });
});

describe("calibration", () => {
    test("export hides the auditor verdict and score joins labels back", () => {
        const row = {
            variant: "v", taskId: "t", repeat: 0, expected: 1,
            findings: [
                { id: "find-1", title: "a, \"quoted\"", observation: "o", query: "SELECT 1", auditVerdict: "confirmed" },
                { id: "find-2", title: "b", observation: "o", auditVerdict: "rejected" },
            ],
        } as unknown as EpisodeResult;
        const items = auditedItems([row]);
        const csv = toCsv(items);
        expect(csv).not.toContain("confirmed");
        const parsed = parseCsv(csv);
        expect(parsed[0]!.title).toBe('a, "quoted"');
        parsed[0]!.human_label = "confirmed";
        parsed[1]!.human_label = "caution";
        parsed[1]!.label_source = "EXAMPLE";
        const report = score(parsed, items);
        expect(report.items).toBe(2);
        expect(report.exampleLabels).toBe(1);
        expect(report.agreement).toBe(0.5);
    });
});

describe("offline episodes", () => {
    test("a fault-free scripted run answers correctly through the real tools and auditor", async () => {
        SCRIPTED_VARIANTS["test-clean"] = { skipProfile: 0, sqlTypo: 0, loop: 0, unsupportedClaim: 0, hallucinate: 0 };
        const r = await runEpisode(task("incidents-billing-users"), { variant: "test-clean", repeat: 0 });
        expect(r.success).toBe(true);
        expect(r.answer).toBe("2310");
        expect(r.stuck.stuck).toBe(false);
        expect(r.tools).toEqual(["consult_playbook", "profile_dataset", "run_analytical_query", "record_finding", "request_auditor_review"]);
        expect(r.findings[0]!.auditVerdict).toBe("confirmed");
        expect(r.tokens.total).toBeGreaterThan(0);
    });

    test("a looping run that gives up is stuck and fails", async () => {
        SCRIPTED_VARIANTS["test-loop"] = { skipProfile: 0, sqlTypo: 0, loop: 1, unsupportedClaim: 0, hallucinate: 0 };
        let r: EpisodeResult | undefined;
        for (let repeat = 0; repeat < 10 && !r?.faults?.giveUpAfterLoop; repeat++) {
            r = await runEpisode(task("churn-overall"), { variant: "test-loop", repeat });
        }
        expect(r!.faults!.giveUpAfterLoop).toBe(true);
        expect(r!.success).toBe(false);
        expect(r!.stuck.reasons).toEqual(["repeated_call"]);
    });

    test("a finding without its query is rejected by the auditor and the answer is flagged", async () => {
        SCRIPTED_VARIANTS["test-unsupported"] = { skipProfile: 0, sqlTypo: 0, loop: 0, unsupportedClaim: 1, hallucinate: 0 };
        const r = await runEpisode(task("churn-overall"), { variant: "test-unsupported", repeat: 0 });
        expect(r.findings[0]!.auditVerdict).toBe("rejected");
        expect(r.stuck.shippedRejectedFinding).toBe(true);
    });
});
