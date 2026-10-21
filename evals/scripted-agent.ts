import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai";
import { rng } from "./stats";
import type { EvalTask } from "./tasks";

/**
 * A scripted stand-in for the model, used to run the eval pipeline offline and deterministically.
 *
 * It drives the real harness, tools, SQLite adapter, and auditor subagent, and it reads its answer
 * out of the tool result it gets back. It is not a model: its failures are injected at fixed rates,
 * so any metric it produces describes those rates, not agent quality.
 */
export interface FaultRates {
    /** Query before loading the dataset (one "no such table" error, then recovers). */
    skipProfile: number;
    /** First query has a syntax error (one error, then recovers). */
    sqlTypo: number;
    /** Re-run the same query three more times; half of these runs then give up without an answer. */
    loop: number;
    /** Record the finding without the query that backs it (the auditor stub rejects it). */
    unsupportedClaim: number;
    /** Answer with a number or name that is not the one the query returned. */
    hallucinate: number;
}

export const SCRIPTED_VARIANTS: Record<string, FaultRates> = {
    baseline: { skipProfile: 0.15, sqlTypo: 0.2, loop: 0.15, unsupportedClaim: 0.15, hallucinate: 0.1 },
    // Same script with fewer injected faults: a stand-in for a prompt or tool change under test.
    candidate: { skipProfile: 0.05, sqlTypo: 0.2, loop: 0.05, unsupportedClaim: 0.05, hallucinate: 0.1 },
};

export interface ScriptedFaults {
    skipProfile: boolean;
    sqlTypo: boolean;
    loop: boolean;
    giveUpAfterLoop: boolean;
    unsupportedClaim: boolean;
    hallucinate: boolean;
}

export function sampleFaults(rates: FaultRates, seed: number): ScriptedFaults {
    const next = rng(seed);
    const loop = next() < rates.loop;
    return {
        skipProfile: next() < rates.skipProfile,
        sqlTypo: next() < rates.sqlTypo,
        loop,
        giveUpAfterLoop: next() < 0.5 && loop,
        unsupportedClaim: next() < rates.unsupportedClaim,
        hallucinate: next() < rates.hallucinate,
    };
}

type Step = { tool: string; args: Record<string, unknown> } | { answer: true } | { giveUp: true };

function plan(task: EvalTask, faults: ScriptedFaults): Step[] {
    const query = { tool: "run_analytical_query", args: { sql: task.referenceSql, rationale: task.question } };
    const steps: Step[] = [{ tool: "consult_playbook", args: {} }];
    if (faults.skipProfile) steps.push(query);
    steps.push({ tool: "profile_dataset", args: { filePath: task.dataset } });
    if (faults.sqlTypo) steps.push({ tool: "run_analytical_query", args: { sql: task.referenceSql.replace("SELECT", "SELEC"), rationale: task.question } });
    steps.push(query);
    if (faults.loop) steps.push(query, query, query);
    if (faults.loop && faults.giveUpAfterLoop) return [...steps, { giveUp: true }];
    steps.push({ tool: "record_finding", args: {} }, { tool: "request_auditor_review", args: { findingId: "find-1" } }, { answer: true });
    return steps;
}

type Message = { role: string; content?: unknown; isError?: boolean; toolName?: string };

const text = (content: unknown): string =>
    typeof content === "string"
        ? content
        : Array.isArray(content)
            ? content.map((p: any) => (p?.type === "text" ? p.text : "")).join("")
            : "";

/** First data cell of the last successful query result's markdown table. */
function lastQueryAnswer(messages: readonly Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.role !== "toolResult" || m.toolName !== "run_analytical_query" || m.isError) continue;
        const row = text(m.content).split("\n").find((line, idx, lines) => idx > 0 && lines[idx - 1]!.includes("---"));
        return row?.split("|")[1]?.trim();
    }
    return undefined;
}

function wrong(value: string): string {
    const n = Number(value);
    return Number.isFinite(n) ? String(Number((n * 1.3 + 0.05).toFixed(4))) : "unknown-service";
}

/** Faux provider whose every response is decided by the script. The auditor subagent gets a rule-based stub. */
export function scriptedProvider(task: EvalTask, faults: ScriptedFaults, modelId = "scripted-analyst"): FauxProviderHandle {
    const steps = plan(task, faults);
    const faux = fauxProvider({ provider: "faux", models: [{ id: modelId, name: "Scripted analyst (offline)" }] });
    const respond = (context: { messages: Message[] }): AssistantMessage => {
        const messages = context.messages;
        const system = JSON.stringify(messages.filter((m) => m.role === "system"));
        if (system.includes("skeptical statistician")) {
            // Auditor stub: reject a finding that cites no query, confirm the rest.
            const prompt = text(messages.filter((m) => m.role === "user").at(-1)?.content);
            return /Evidence Query: N\/A/.test(prompt)
                ? fauxAssistantMessage("VERDICT: REJECTED\nAUDIT REASONING: The finding cites no query, so it cannot be reproduced.")
                : fauxAssistantMessage("VERDICT: CONFIRMED\nAUDIT REASONING: The cited query supports the observation.");
        }

        const index = messages.filter((m) => m.role === "assistant").length;
        const step = steps[Math.min(index, steps.length - 1)]!;
        if ("giveUp" in step) return fauxAssistantMessage("The query keeps returning the same result and I cannot make progress, so I am stopping here.");
        const found = lastQueryAnswer(messages) ?? "unknown";
        const value = faults.hallucinate ? wrong(found) : found;
        if ("answer" in step) return fauxAssistantMessage(`${task.question}\nThe query returned ${value}.\nANSWER: ${value}`);
        const args = step.tool === "record_finding"
            ? {
                title: `${task.id}: ${value}`,
                observation: `${task.question} The data gives ${value}.`,
                impact: "medium",
                confidence: 0.8,
                rationale: "Direct aggregate over the full table.",
                ...(faults.unsupportedClaim ? {} : { queryUsed: task.referenceSql }),
                recommendations: [],
            }
            : step.args;
        return fauxAssistantMessage(fauxToolCall(step.tool, args as JsonObject), { stopReason: "toolUse" });
    };
    // One factory per model call; 64 is far above the longest script.
    faux.setResponses(Array.from({ length: 64 }, () => respond as never));
    return faux;
}
