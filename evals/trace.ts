/**
 * Turn a DataClaw transcript into a flat trace, and flag runs that got stuck.
 * Everything here is read from the events `src/transcript` parses out of the persisted messages:
 * tool calls with their results, assistant text, and the stop reason.
 */
import { asRecord, parseTranscript } from "../src/transcript";

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
    const transcript = parseTranscript(messages);
    const toolCalls: TraceToolCall[] = [];
    let finalText = "";

    for (const event of transcript.events) {
        if (event.kind === "assistantText") {
            finalText = event.text;
        } else if (event.kind === "toolCall") {
            const result = event.result;
            toolCalls.push({
                name: event.toolName,
                args: canonical(event.args ?? {}),
                // A call with no result never finished (aborted or crashed), which is a failure too.
                isError: result ? result.isError : true,
                ...(result?.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
                resultText: result?.text ?? "",
            });
        }
    }

    return {
        toolCalls,
        finalText,
        ...(transcript.stopReason !== undefined ? { lastStopReason: transcript.stopReason } : {}),
        ...(transcript.errorMessage !== undefined ? { lastErrorMessage: transcript.errorMessage } : {}),
        assistantTurns: transcript.assistantMessages,
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
