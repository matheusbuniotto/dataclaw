import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { groupIntoTurns } from "../src/prototype/ChatComponents";
import { buildTurns, readWorkspace, transcriptFrom } from "../src/prototype/workspace";
import { createAnalystHarness } from "../src/harness";
import { isSyntheticMissingResult, parseTranscript, type TranscriptEvent } from "../src/transcript";
import { extractTrace } from "../evals/trace";

const call = (id: string, name: string, args: unknown = {}) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, name: string, text: string, isError = false) =>
    ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError });

type ToolCallEvent = Extract<TranscriptEvent, { kind: "toolCall" }>;

const kinds = (events: readonly TranscriptEvent[]) => events.map((event) => event.kind);
const calls = (events: readonly TranscriptEvent[]): ToolCallEvent[] =>
    events.flatMap((event) => (event.kind === "toolCall" ? [event] : []));

describe("transcript parse", () => {
    test("assistant text only: one turn, the text, and the stop reason", () => {
        const transcript = parseTranscript([
            { role: "system", content: "You are DataClaw." },
            { role: "user", content: "Which region leads?", timestamp: 1_000 },
            { role: "assistant", content: [{ type: "text", text: "North leads." }], stopReason: "stop", timestamp: 1_500 },
        ]);

        expect(kinds(transcript.events)).toEqual(["turnStart", "assistantText", "stop"]);
        expect(transcript.turns).toHaveLength(1);
        expect(transcript.turns[0]!.text).toBe("Which region leads?");
        expect(transcript.turns[0]!.timestamp).toBe(1_000);
        expect(transcript.stopReason).toBe("stop");
        expect(transcript.errorMessage).toBeUndefined();
        expect(transcript.assistantMessages).toBe(1);
    });

    test("parallel tool calls keep their order and each pairs with its own result", () => {
        const messages = [
            { role: "user", content: "Compare two tables", timestamp: 1_000 },
            {
                role: "assistant",
                content: [call("a", "query_data", { sql: "SELECT 1" }), call("b", "query_data", { sql: "SELECT 2" })],
                stopReason: "toolUse",
                timestamp: 1_100,
            },
            result("a", "query_data", "1"),
            result("b", "query_data", "2"),
        ];
        const transcript = parseTranscript(messages);

        expect(kinds(transcript.events)).toEqual(["turnStart", "toolCall", "toolCall", "stop"]);
        const [first, second] = calls(transcript.events);
        expect(first!.callId).toBe("a");
        expect(second!.callId).toBe("b");
        expect(first!.result?.text).toBe("1");
        expect(second!.result?.text).toBe("2");

        const items = transcriptFrom(transcript);
        expect(items.map((item) => item.role)).toEqual(["user", "assistant"]);
        expect(items[1]!.tools!.map((tool) => [tool.callId, tool.status, tool.resultText])).toEqual([
            ["a", "completed", "1"],
            ["b", "completed", "2"],
        ]);
    });

    test("a result that arrives out of order still pairs with its call, once", () => {
        const messages = [
            { role: "user", content: "Two reads", timestamp: 1_000 },
            {
                role: "assistant",
                content: [call("first", "read", { path: "a.csv" }), call("second", "read", { path: "b.csv" })],
                stopReason: "toolUse",
                timestamp: 1_100,
            },
            result("second", "read", "b rows"),
            result("first", "read", "a rows"),
        ];
        const transcript = parseTranscript(messages);

        expect(kinds(transcript.events)).toEqual(["turnStart", "toolCall", "toolCall", "stop"]);
        expect(calls(transcript.events).map((event) => event.result?.text)).toEqual(["a rows", "b rows"]);

        const items = transcriptFrom(transcript);
        expect(items).toHaveLength(2);
        expect(items[1]!.tools!.map((tool) => [tool.callId, tool.resultText])).toEqual([
            ["first", "a rows"],
            ["second", "b rows"],
        ]);
    });

    test("a call with no result is a call, not a dropped turn", () => {
        const messages = [
            { role: "user", content: "Count trips", timestamp: 1_000 },
            {
                role: "assistant",
                content: [call("open", "query_data", { sql: "SELECT COUNT(*) FROM trips" })],
                stopReason: "toolUse",
                timestamp: 1_100,
            },
        ];
        const transcript = parseTranscript(messages);

        expect(kinds(transcript.events)).toEqual(["turnStart", "toolCall", "stop"]);
        const [pending] = calls(transcript.events);
        expect(pending!.callId).toBe("open");
        expect(pending!.result).toBeUndefined();

        const tool = transcriptFrom(transcript)[1]!.tools![0]!;
        expect(tool.status).toBe("running");
        expect(tool.isError).toBeUndefined();
        expect(tool.resultText).toBeUndefined();

        // The eval trace reads the same missing result as a failure, and the run list keeps the step.
        expect(extractTrace(messages).toolCalls).toMatchObject([{ name: "query_data", isError: true, resultText: "" }]);
        const turn = buildTurns(messages)[0]!;
        expect(turn.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(["Request", "query_data"]);
        expect(turn.error).toBeUndefined();
    });

    test("the harness's stand-in for an unfinished call is not a result", () => {
        const synthetic = {
            role: "toolResult",
            toolCallId: "open",
            toolName: "query_data",
            content: [{ type: "text", text: "Tool result unavailable: history ends before this call completed." }],
            isError: true,
            details: { reason: "missing_result" },
            timestamp: 1_100,
        };
        expect(isSyntheticMissingResult(synthetic)).toBe(true);

        const transcript = parseTranscript([
            { role: "user", content: "Count trips", timestamp: 1_000 },
            { role: "assistant", content: [call("open", "query_data", { sql: "SELECT 1" })], stopReason: "toolUse" },
            synthetic,
        ]);

        expect(kinds(transcript.events)).toEqual(["turnStart", "toolCall", "stop"]);
        expect(transcriptFrom(transcript)[1]!.tools![0]!.status).toBe("running");
        expect(buildTurns(transcript)[0]!.error).toBeUndefined();
    });

    test("an isError result carries its failure to every consumer", () => {
        const messages = [
            { role: "user", content: "Profile the file", timestamp: 1_000 },
            { role: "assistant", content: [call("bad", "query_data", { sql: "SELECT * FROM trips" })], stopReason: "toolUse" },
            { ...result("bad", "query_data", "Error: no such table: trips", true), durationMs: 12 },
        ];
        const transcript = parseTranscript(messages);

        const [event] = calls(transcript.events);
        expect(event!.result).toMatchObject({
            isError: true,
            text: "Error: no such table: trips",
            durationMs: 12,
        });

        const tool = transcriptFrom(transcript)[1]!.tools![0]!;
        expect(tool.status).toBe("error");
        expect(tool.isError).toBe(true);
        expect(extractTrace(messages).toolCalls[0]).toMatchObject({ isError: true, durationMs: 12 });
        expect(buildTurns(messages)[0]!.error).toBe("Error: no such table: trips");
    });

    test("an aborted stop reason is the transcript's stop reason", () => {
        const messages = [
            { role: "user", content: "Count trips", timestamp: 1_000 },
            { role: "assistant", content: [], stopReason: "aborted", timestamp: 1_400 },
        ];
        const transcript = parseTranscript(messages);

        expect(kinds(transcript.events)).toEqual(["turnStart", "stop"]);
        expect(transcript.stopReason).toBe("aborted");
        expect(transcript.errorMessage).toBeUndefined();
        // Nothing to render, but the turn and its stop reason are still there.
        expect(transcriptFrom(transcript).map((item) => item.role)).toEqual(["user"]);
        expect(extractTrace(messages).lastStopReason).toBe("aborted");
        expect(buildTurns(messages)).toHaveLength(1);
    });

    test("an error stop reason exposes the provider message", () => {
        const messages = [
            { role: "user", content: "Count trips", timestamp: 1_000 },
            {
                role: "assistant",
                content: [],
                stopReason: "error",
                errorMessage: "provider rate limited",
                timestamp: 1_400,
            },
        ];
        const transcript = parseTranscript(messages);

        expect(kinds(transcript.events)).toEqual(["turnStart", "stop"]);
        expect(transcript.stopReason).toBe("error");
        expect(transcript.errorMessage).toBe("provider rate limited");
        expect(transcriptFrom(transcript)[1]!.text).toBe("provider rate limited");
        expect(extractTrace(messages).lastErrorMessage).toBe("provider rate limited");
        expect(buildTurns(messages)[0]!.error).toBe("provider rate limited");
    });
});

/** One conversation every consumer reads: a call with a result, a failed call, and an answer. */
const FIXTURE = [
    { role: "user", content: "Which region leads?", timestamp: 1_000 },
    { role: "assistant", content: [call("q1", "query_data", { sql: "SELECT region FROM leads" })], stopReason: "toolUse", timestamp: 1_100 },
    result("q1", "query_data", "region\n------\nnorth"),
    { role: "assistant", content: [call("r1", "read", { path: "/workspace/notes.md" })], stopReason: "toolUse", timestamp: 1_200 },
    result("r1", "read", "Error: no such file", true),
    { role: "assistant", content: [{ type: "text", text: "ANSWER: north" }], stopReason: "stop", timestamp: 1_300 },
];

describe("one read model, four consumers", () => {
    test("the run list, the chat view, and the eval trace agree on one fixture", () => {
        const transcript = parseTranscript(FIXTURE);
        const turns = buildTurns(transcript);
        const chatTurns = groupIntoTurns(transcriptFrom(transcript));
        const trace = extractTrace(FIXTURE);

        expect(turns).toHaveLength(1);
        expect(chatTurns.filter((turn) => turn.role === "user")).toHaveLength(turns.length);

        const turnTools = turns.flatMap((turn) =>
            turn.checkpoints.flatMap((checkpoint) => (checkpoint.label === "Request" ? [] : [checkpoint.label])));
        const chatTools = chatTurns.flatMap((turn) => turn.tools.map((tool) => tool.toolName));
        expect(turnTools).toEqual(["query_data", "read"]);
        expect(chatTools).toEqual(turnTools);
        expect(trace.toolCalls.map((tool) => tool.name)).toEqual(turnTools);
        expect(trace.toolCalls.map((tool) => tool.isError)).toEqual([false, true]);
        expect(chatTurns.flatMap((turn) => turn.tools.map((tool) => tool.status))).toEqual(["completed", "error"]);
        expect(trace.finalText).toBe("ANSWER: north");
    });

    test("consumers read one parse without reparsing the messages", () => {
        const transcript = parseTranscript(FIXTURE);
        expect(buildTurns(transcript)).toEqual(buildTurns(FIXTURE));
        expect(transcriptFrom(transcript)).toEqual(transcriptFrom(FIXTURE));
    });

    test("readWorkspace's run list and transcript agree with the projections", async () => {
        const faux = fauxProvider({ provider: "faux", models: [{ id: "transcript-model", name: "Transcript model" }] });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("consult_playbook", {}), { stopReason: "toolUse" }),
            fauxAssistantMessage("ANSWER: north"),
        ]);
        const projectRoot = await mkdtemp(join(tmpdir(), "dataclaw-transcript-"));
        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "transcript-model" },
            projectRoot,
            workspaceDir: join(projectRoot, "workspace"),
        });

        try {
            await analyst.conversation.submit(
                { type: "input", content: "Which region leads?", requestId: "transcript-parity" },
                analyst.context,
            );
            await analyst.conversation.waitForIdle(analyst.context);

            const view = await analyst.conversation.context(analyst.context);
            const workspace = await readWorkspace(analyst);
            const turns = buildTurns(view.messages);
            const chatTurns = groupIntoTurns(transcriptFrom(view.messages));
            const trace = extractTrace(view.messages);

            const turnRuns = workspace.runs.filter((run) => run.id.startsWith("turn-"));
            expect(turnRuns).toHaveLength(turns.length);
            expect(turns).toHaveLength(1);
            expect(chatTurns.filter((turn) => turn.role === "user")).toHaveLength(turns.length);

            const chatTools = chatTurns.flatMap((turn) => turn.tools.map((tool) => tool.toolName));
            const workspaceTools = workspace.transcript.flatMap((item) => item.tools ?? []).map((tool) => tool.toolName);
            expect(chatTools).toEqual(["consult_playbook"]);
            expect(workspaceTools).toEqual(chatTools);
            expect(trace.toolCalls.map((tool) => tool.name)).toEqual(chatTools);
        } finally {
            await analyst.close();
            await rm(projectRoot, { recursive: true, force: true });
        }
    });
});
