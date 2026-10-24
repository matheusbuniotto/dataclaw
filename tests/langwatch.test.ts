import { describe, expect, test } from "bun:test";
import { LangWatchTracer } from "../src/observability/langwatch";
import type { Transcript } from "../src/transcript/types";

describe("LangWatch observability", () => {
    test("buffers traces when no API key is set", async () => {
        const tracer = new LangWatchTracer({ apiKey: undefined });
        expect(tracer.isConfigured).toBe(false);

        const trace = {
            trace_id: "test-tr-1",
            metadata: { service_name: "test", environment: "test" },
            spans: [],
        };

        const res = await tracer.sendTrace(trace);
        expect(res.ok).toBe(true);
        expect(res.status).toBe("buffered");
        expect(tracer.bufferedCount).toBe(1);
        expect(tracer.getBufferedTraces()[0]?.trace_id).toBe("test-tr-1");

        tracer.clearBuffer();
        expect(tracer.bufferedCount).toBe(0);
    });

    test("converts Transcript into LangWatch spans and metadata", () => {
        const tracer = new LangWatchTracer();

        const fakeTranscript: Transcript = {
            kind: "transcript",
            events: [
                { kind: "turnStart", index: 0, text: "Analyze churn rate" },
                {
                    kind: "toolCall",
                    index: 1,
                    callId: "call-1",
                    toolName: "execute_sql_query",
                    args: { query: "SELECT count(*) FROM churn" },
                    result: { callId: "call-1", text: "42", isError: false, durationMs: 25 },
                },
                {
                    kind: "toolCall",
                    index: 2,
                    callId: "call-2",
                    toolName: "request_auditor_review",
                    args: { claim: "High churn" },
                    result: { callId: "call-2", text: "CONFIRMED", isError: false, durationMs: 15 },
                },
                { kind: "assistantText", index: 3, text: "Here are the findings." },
                { kind: "stop", index: 4, stopReason: "stop" },
            ],
            turns: [
                { turn: 0, index: 0, text: "Analyze churn rate", events: [] },
            ],
            assistantMessages: 1,
            stopReason: "stop",
        };

        const trace = tracer.fromTranscript(fakeTranscript, {
            threadId: "conv-123",
            agentId: "analyst-1",
            goal: "Analyze churn rate",
            stuck: false,
        });

        expect(trace.trace_id).toBeDefined();
        expect(trace.metadata.thread_id).toBe("conv-123");
        expect(trace.metadata.goal).toBe("Analyze churn rate");

        // Should have root chain span, 1 tool span, 1 eval span (auditor), and 1 LLM span
        expect(trace.spans.length).toBe(4);
        expect(trace.spans[0]?.type).toBe("chain");
        expect(trace.spans[1]?.type).toBe("tool");
        expect(trace.spans[1]?.name).toBe("execute_sql_query");
        expect(trace.spans[2]?.type).toBe("eval"); // request_auditor_review becomes an eval span!
        expect(trace.spans[2]?.name).toBe("request_auditor_review");
        expect(trace.spans[3]?.type).toBe("llm");
    });

    test("flags stuck-state guardrails in trace spans", () => {
        const tracer = new LangWatchTracer();
        const fakeTranscript: Transcript = {
            kind: "transcript",
            events: [],
            turns: [],
            assistantMessages: 0,
        };

        const trace = tracer.fromTranscript(fakeTranscript, {
            stuck: true,
            stuckReasons: ["repeated_call", "tool_budget"],
        });

        expect(trace.metadata.stuck).toBe(true);
        const guardSpan = trace.spans.find((s) => s.type === "guardrail");
        expect(guardSpan).toBeDefined();
        expect(guardSpan?.name).toBe("stuck_loop_detector");
        expect(guardSpan?.error).toContain("repeated_call");
    });

    test("records sample trace and reflects in observability summary", () => {
        const { getObservabilitySummary, recordSampleTrace } = require("../src/console/api/observability-api");
        const res = recordSampleTrace();
        expect(res.ok).toBe(true);
        expect(res.trace_id).toContain("tr-demo-");

        const summary = getObservabilitySummary();
        expect(summary.langwatch.bufferedCount).toBeGreaterThanOrEqual(1);
        expect(summary.langwatch.recentTraces.length).toBeGreaterThanOrEqual(1);
        expect(summary.langwatch.recentTraces.some((t: any) => t.trace_id === res.trace_id)).toBe(true);
    });
});
