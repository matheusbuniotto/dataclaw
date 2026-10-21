/**
 * Turn a DataClaw transcript into a flat trace, and flag runs that got stuck.
 * Everything here is read from what the harness already persists: assistant messages
 * (tool calls, stop reason), tool results (isError, durationMs), and FindingsDoc audit verdicts.
 */

export interface TraceToolCall {
    name: string;
    /** Canonical JSON of the arguments, so identical calls compare equal. */
    args: string;
    isError: boolean;
    durationMs?: number;
    resultText: string;
}

export interface TraceFinding {
    id: string;
    title: string;
    observation: string;
    query?: string;
    auditVerdict?: "confirmed" | "caution" | "rejected";
}

export interface EpisodeTrace {
    toolCalls: TraceToolCall[];
    /** Text of the last assistant message that has text, or "" when the run produced none. */
    finalText: string;
    /** Stop reason of the last assistant message ("stop", "error", "aborted", ...). */
    lastStopReason?: string;
    /** Provider error on the last assistant message, when it failed. */
    lastErrorMessage?: string;
    assistantTurns: number;
    findings: TraceFinding[];
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined =>
    value !== null && typeof value === "object" ? (value as Json) : undefined;

function textOf(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .flatMap((part) => {
            const record = asRecord(part);
            return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
        })
        .join("");
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const record = asRecord(value);
    if (record) {
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

export function extractTrace(messages: readonly unknown[], findings: readonly TraceFinding[] = []): EpisodeTrace {
    const results = new Map<string, Json>();
    for (const message of messages) {
        const record = asRecord(message);
        if (record?.role === "toolResult" && typeof record.toolCallId === "string") results.set(record.toolCallId, record);
    }

    const toolCalls: TraceToolCall[] = [];
    let finalText = "";
    let lastStopReason: string | undefined;
    let lastErrorMessage: string | undefined;
    let assistantTurns = 0;

    for (const message of messages) {
        const record = asRecord(message);
        if (record?.role !== "assistant") continue;
        assistantTurns++;
        if (typeof record.stopReason === "string") lastStopReason = record.stopReason;
        lastErrorMessage = record.stopReason === "error" && typeof record.errorMessage === "string" ? record.errorMessage : undefined;
        const text = textOf(record.content).trim();
        if (text) finalText = text;
        if (!Array.isArray(record.content)) continue;
        for (const part of record.content) {
            const call = asRecord(part);
            if (call?.type !== "toolCall" || typeof call.name !== "string") continue;
            const result = typeof call.id === "string" ? results.get(call.id) : undefined;
            toolCalls.push({
                name: call.name,
                args: canonical(call.arguments ?? {}),
                // A call with no result never finished (aborted or crashed), which is a failure too.
                isError: result ? Boolean(result.isError) : true,
                ...(typeof result?.durationMs === "number" ? { durationMs: result.durationMs } : {}),
                resultText: result ? textOf(result.content) : "",
            });
        }
    }

    return {
        toolCalls,
        finalText,
        ...(lastStopReason ? { lastStopReason } : {}),
        ...(lastErrorMessage ? { lastErrorMessage } : {}),
        assistantTurns,
        findings: [...findings],
    };
}

export interface StuckThresholds {
    /** Identical tool call (same name and arguments) this many times. */
    repeatedCall: number;
    /** This many tool errors in a row. */
    errorStreak: number;
    /** More tool calls than this in one task. */
    toolBudget: number;
}

export const DEFAULT_STUCK_THRESHOLDS: StuckThresholds = { repeatedCall: 3, errorStreak: 3, toolBudget: 25 };

export type StuckReason = "repeated_call" | "error_streak" | "tool_budget" | "no_final_answer";

export interface StuckAssessment {
    stuck: boolean;
    reasons: StuckReason[];
    maxRepeats: number;
    longestErrorStreak: number;
    /** The auditor rejected a finding and the agent answered without recording a revised one. */
    shippedRejectedFinding: boolean;
}

/**
 * A run is "stuck" when it loops (repeats the same call), keeps failing (error streak), runs past
 * its tool budget, or ends without an answer. These are visible in the trace alone, without
 * knowing the right answer, so the same detector works on production traffic.
 */
export function assessStuck(trace: EpisodeTrace, thresholds: StuckThresholds = DEFAULT_STUCK_THRESHOLDS): StuckAssessment {
    const counts = new Map<string, number>();
    let maxRepeats = 0;
    let streak = 0;
    let longestErrorStreak = 0;
    for (const call of trace.toolCalls) {
        const key = `${call.name}:${call.args}`;
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        maxRepeats = Math.max(maxRepeats, count);
        streak = call.isError ? streak + 1 : 0;
        longestErrorStreak = Math.max(longestErrorStreak, streak);
    }

    const reasons: StuckReason[] = [];
    if (maxRepeats >= thresholds.repeatedCall) reasons.push("repeated_call");
    if (longestErrorStreak >= thresholds.errorStreak) reasons.push("error_streak");
    if (trace.toolCalls.length > thresholds.toolBudget) reasons.push("tool_budget");
    if (!trace.finalText || trace.lastStopReason === "error" || trace.lastStopReason === "aborted") {
        reasons.push("no_final_answer");
    }

    return {
        stuck: reasons.length > 0,
        reasons,
        maxRepeats,
        longestErrorStreak,
        shippedRejectedFinding: shippedRejected(trace),
    };
}

function shippedRejected(trace: EpisodeTrace): boolean {
    const rejected = trace.findings.filter((f) => f.auditVerdict === "rejected");
    if (rejected.length === 0 || !trace.finalText) return false;
    // A finding recorded after the last rejection counts as a revision.
    const lastRejected = Math.max(...rejected.map((f) => trace.findings.indexOf(f)));
    return trace.findings.slice(lastRejected + 1).every((f) => f.auditVerdict === "rejected");
}
