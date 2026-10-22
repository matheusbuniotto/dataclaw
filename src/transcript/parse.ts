import type { Transcript, TranscriptEvent, TranscriptToolResult, TranscriptTurn } from "./types";

export type Json = Record<string, unknown>;

export function asRecord(value: unknown): Json | undefined {
    return value !== null && typeof value === "object" ? (value as Json) : undefined;
}

/** Text blocks of a message content: trimmed, newline-joined, "" when there are none. */
export function textFromContent(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content.flatMap((part) => {
        const record = asRecord(part);
        return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    }).join("\n").trim();
}

function thinkingFromContent(content: unknown): string {
    if (!Array.isArray(content)) return "";
    return content.flatMap((part) => {
        const record = asRecord(part);
        return record?.type === "thinking" && typeof record.thinking === "string" ? [record.thinking] : [];
    }).join("\n\n").trim();
}

/** The text the harness writes into the stand-in result for a call that never finished. */
export const SYNTHETIC_MISSING_RESULT_TEXT = "Tool result unavailable: history ends before this call completed.";

/** True when a result's text is the harness stand-in, whichever surface is reading it. */
export function isSyntheticMissingResultText(text: string): boolean {
    return text.includes(SYNTHETIC_MISSING_RESULT_TEXT);
}

/**
 * The harness persists a stand-in result when history ends before a call completed. It means
 * "no result yet", not "the call failed", so the parse never pairs it with a call.
 */
export function isSyntheticMissingResult(record: Json): boolean {
    const details = asRecord(record.details);
    if (details?.reason === "missing_result") return true;
    return isSyntheticMissingResultText(textFromContent(record.content));
}

/** True for a value returned by `parseTranscript`, so callers can share one parse across consumers. */
export function isTranscript(value: unknown): value is Transcript {
    return asRecord(value)?.kind === "transcript";
}

function toResult(record: Json, callId: string): TranscriptToolResult {
    return {
        callId,
        ...(typeof record.toolName === "string" ? { toolName: record.toolName } : {}),
        text: textFromContent(record.content),
        isError: Boolean(record.isError),
        ...(typeof record.durationMs === "number" ? { durationMs: record.durationMs } : {}),
    };
}

/** Real results keyed by call id. Synthetic "no result yet" records are not results. */
function resultsByCallId(messages: readonly unknown[]): Map<string, TranscriptToolResult> {
    const results = new Map<string, TranscriptToolResult>();
    for (const message of messages) {
        const record = asRecord(message);
        if (record?.role !== "toolResult" || typeof record.toolCallId !== "string") continue;
        if (isSyntheticMissingResult(record)) continue;
        results.set(record.toolCallId, toResult(record, record.toolCallId));
    }
    return results;
}

/** Call ids that some assistant message asks for, so a result's call is found even out of order. */
function callIdsIn(messages: readonly unknown[]): Set<string> {
    const ids = new Set<string>();
    for (const message of messages) {
        const record = asRecord(message);
        if (record?.role !== "assistant" || !Array.isArray(record.content)) continue;
        for (const part of record.content) {
            const block = asRecord(part);
            if (block?.type === "toolCall" && typeof block.id === "string" && block.id) ids.add(block.id);
        }
    }
    return ids;
}

/**
 * Parse persisted conversation messages into typed events, the one read model behind the console
 * run list, the chat view, and the eval trace. System messages and message shapes the harness never
 * writes are skipped; every other message contributes the events its content and role imply.
 */
export function parseTranscript(messages: readonly unknown[]): Transcript {
    const results = resultsByCallId(messages);
    const callIds = callIdsIn(messages);
    const events: TranscriptEvent[] = [];
    const turns: TranscriptTurn[] = [];
    let turn: TranscriptTurn | undefined;
    let assistantMessages = 0;
    let stopReason: string | undefined;
    let errorMessage: string | undefined;

    const push = (event: TranscriptEvent): void => {
        events.push(event);
        turn?.events.push(event);
    };

    messages.forEach((message, index) => {
        const record = asRecord(message);
        if (!record) return;
        const role = typeof record.role === "string" ? record.role : "";
        const timestamp = typeof record.timestamp === "number" ? record.timestamp : undefined;

        if (role === "user") {
            const text = textFromContent(record.content);
            const start: TranscriptEvent = { kind: "turnStart", index, timestamp, text };
            events.push(start);
            turn = { turn: turns.length, index, timestamp, text, events: [start] };
            turns.push(turn);
            return;
        }

        if (role === "assistant") {
            assistantMessages++;
            const stop = typeof record.stopReason === "string" ? record.stopReason : undefined;
            const failure = stop === "error" && typeof record.errorMessage === "string"
                ? record.errorMessage
                : undefined;
            // Mirrors what the trace reports: the last stop reason seen, the last message's error.
            if (stop !== undefined) stopReason = stop;
            errorMessage = failure;

            const thinking = thinkingFromContent(record.content);
            if (thinking) push({ kind: "assistantThinking", index, timestamp, text: thinking });
            const text = textFromContent(record.content);
            if (text) push({ kind: "assistantText", index, timestamp, text });

            if (Array.isArray(record.content)) {
                let ordinal = 0;
                for (const part of record.content) {
                    const block = asRecord(part);
                    if (block?.type !== "toolCall" || typeof block.name !== "string") continue;
                    const callId = typeof block.id === "string" && block.id ? block.id : `call-${index}-${ordinal}`;
                    ordinal++;
                    push({
                        kind: "toolCall",
                        index,
                        timestamp,
                        callId,
                        toolName: block.name,
                        args: block.arguments,
                        result: results.get(callId),
                    });
                }
            }

            if (stop !== undefined) {
                push({
                    kind: "stop",
                    index,
                    timestamp,
                    stopReason: stop,
                    ...(failure !== undefined ? { errorMessage: failure } : {}),
                });
            }
            return;
        }

        if (role === "toolResult") {
            if (isSyntheticMissingResult(record)) return;
            const callId = typeof record.toolCallId === "string" ? record.toolCallId : "";
            // A result that answers a call is attached to that call's event, wherever it arrived.
            if (callId && callIds.has(callId)) return;
            push({ kind: "toolResult", index, timestamp, result: toResult(record, callId) });
        }
    });

    return {
        kind: "transcript",
        events,
        turns,
        assistantMessages,
        ...(stopReason !== undefined ? { stopReason } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
    };
}
