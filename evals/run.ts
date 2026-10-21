import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createAnalystHarness } from "../src/harness";
import { SqliteDataAdapter } from "../src/adapters/sqlite-adapter";
import { setSharedAdapter } from "../src/tools/analyst-tools";
import type { FindingsDocument } from "../src/docs/findings";
import { loadPiCredentialStore, providerConfigured, providerEnvNames } from "../src/pi-config";
import { EVAL_TASKS, expectedAnswer, grade, answerLine, taskPrompt, type EvalTask } from "./tasks";
import { assessStuck, extractTrace, type StuckAssessment, type TraceFinding } from "./trace";
import { SCRIPTED_VARIANTS, sampleFaults, scriptedProvider, type ScriptedFaults } from "./scripted-agent";
import { hashSeed } from "./stats";
import { renderReport } from "./report";

/** USD per million tokens, applied only when the provider reports no cost (the offline scripted model). */
export const NOMINAL_PRICE_PER_MTOK = { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 };

export interface EpisodeResult {
    variant: string;
    taskId: string;
    repeat: number;
    model: string;
    /** "scripted" runs are offline and synthetic; "model" runs used a real provider. */
    mode: "scripted" | "model";
    expected: string | number;
    answer?: string;
    success: boolean;
    stuck: StuckAssessment;
    toolCalls: number;
    toolErrors: number;
    tools: string[];
    findings: TraceFinding[];
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    costUsd: number;
    costSource: "provider" | "nominal";
    latencyMs: number;
    faults?: ScriptedFaults;
    error?: string;
}

export interface EpisodeOptions {
    variant: string;
    repeat: number;
    /** Real provider/model. Omit for the offline scripted agent. */
    model?: { provider: string; modelId: string };
    timeoutMs?: number;
}

export async function runEpisode(task: EvalTask, options: EpisodeOptions): Promise<EpisodeResult> {
    const expected = await expectedAnswer(task);
    const scripted = options.model === undefined;
    const rates = SCRIPTED_VARIANTS[options.variant];
    if (scripted && !rates) throw new Error(`Unknown scripted variant "${options.variant}".`);
    const faults = scripted ? sampleFaults(rates!, hashSeed(`${options.variant}|${task.id}|${options.repeat}`)) : undefined;
    const model = options.model ?? { provider: "faux", modelId: "scripted-analyst" };

    // A fresh SQLite adapter per episode, so one run's loaded table cannot leak into the next.
    setSharedAdapter(await SqliteDataAdapter.create(":memory:"));
    const home = await mkdtemp(join(tmpdir(), "dataclaw-eval-"));
    const analyst = await createAnalystHarness({
        storagePath: ":memory:",
        resume: false,
        databricks: false,
        model,
        ...(faults ? { fauxHandle: scriptedProvider(task, faults, model.modelId) } : {}),
        projectRoot: home,
        workspaceDir: join(home, "workspace"),
    });

    const started = performance.now();
    let error: string | undefined;
    try {
        await analyst.conversation.submit(
            { type: "input", content: taskPrompt(task), requestId: `eval:${options.variant}:${task.id}:${options.repeat}` },
            analyst.context,
        );
        const idle = analyst.conversation.waitForIdle(analyst.context).then(() => "idle" as const);
        const timeout = new Promise<"timeout">((resolve) => {
            const timer = setTimeout(() => resolve("timeout"), options.timeoutMs ?? 240_000);
            void idle.finally(() => clearTimeout(timer));
        });
        if ((await Promise.race([idle, timeout])) === "timeout") {
            error = "timeout";
            await analyst.conversation.abort(analyst.context);
        }
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }
    const latencyMs = performance.now() - started;

    try {
        const view = await analyst.conversation.context(analyst.context);
        // The doc helpers are typed as JSON values; FindingsDoc's shape is fixed by its definition.
        const findingsDoc = (await analyst.getFindings()) as FindingsDocument | undefined;
        const findings = (findingsDoc?.findings ?? []).map((f) => ({
            id: f.id,
            title: f.title,
            observation: f.observation,
            ...(f.evidence.query ? { query: f.evidence.query } : {}),
            ...(f.auditVerdict ? { auditVerdict: f.auditVerdict } : {}),
        }));
        const trace = extractTrace(view.messages, findings);
        const usage = await analyst.harness.usage(analyst.context);
        const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        let providerCost = 0;
        for (const u of Object.values(usage.models ?? {})) {
            tokens.input += u.input;
            tokens.output += u.output;
            tokens.cacheRead += u.cacheRead;
            tokens.cacheWrite += u.cacheWrite;
            tokens.total += u.totalTokens;
            providerCost += u.cost.total;
        }
        const nominal = (tokens.input * NOMINAL_PRICE_PER_MTOK.input + tokens.output * NOMINAL_PRICE_PER_MTOK.output +
            tokens.cacheRead * NOMINAL_PRICE_PER_MTOK.cacheRead + tokens.cacheWrite * NOMINAL_PRICE_PER_MTOK.cacheWrite) / 1e6;
        const answer = answerLine(trace.finalText);

        return {
            variant: options.variant,
            taskId: task.id,
            repeat: options.repeat,
            model: `${model.provider}/${model.modelId}`,
            mode: scripted ? "scripted" : "model",
            expected,
            ...(answer !== undefined ? { answer } : {}),
            success: !error && grade(task, expected, trace.finalText),
            stuck: assessStuck(trace),
            toolCalls: trace.toolCalls.length,
            toolErrors: trace.toolCalls.filter((c) => c.isError).length,
            tools: trace.toolCalls.map((c) => c.name),
            findings,
            tokens,
            // Real runs report the provider's cost (0 when its catalog has no price); only scripted runs are priced nominally.
            costUsd: scripted ? nominal : providerCost,
            costSource: scripted ? "nominal" : "provider",
            latencyMs: Math.round(latencyMs),
            ...(faults ? { faults } : {}),
            ...(error ?? trace.lastErrorMessage ? { error: error ?? trace.lastErrorMessage } : {}),
        };
    } finally {
        await analyst.close();
        await rm(home, { recursive: true, force: true });
    }
}

async function main() {
    const { values } = parseArgs({
        options: {
            variants: { type: "string", default: "baseline,candidate" },
            model: { type: "string" },
            label: { type: "string" },
            repeats: { type: "string", default: "5" },
            tasks: { type: "string" },
            "timeout-ms": { type: "string", default: "240000" },
            out: { type: "string", default: "evals/results" },
        },
    });
    const repeats = Number(values.repeats);
    const tasks = values.tasks ? EVAL_TASKS.filter((t) => values.tasks!.split(",").includes(t.id)) : EVAL_TASKS;
    let model: { provider: string; modelId: string } | undefined;
    if (values.model) {
        const [provider, ...rest] = values.model.split("/");
        model = { provider: provider!, modelId: rest.join("/") };
    }
    if (model && !providerConfigured(model.provider, loadPiCredentialStore().providerIds)) {
        const env = providerEnvNames(model.provider);
        console.error(`No credential for provider "${model.provider}". Log in with pi, or set ${env.join(" or ") || "its API key"}.`);
        process.exit(1);
    }
    const variants = model ? [values.label ?? values.model!.replace(/[^\w.-]+/g, "_")] : values.variants!.split(",");

    await mkdir(values.out!, { recursive: true });
    const all: EpisodeResult[] = [];
    for (const variant of variants) {
        const rows: EpisodeResult[] = [];
        for (let repeat = 0; repeat < repeats; repeat++) {
            for (const task of tasks) {
                const result = await runEpisode(task, { variant, repeat, ...(model ? { model } : {}), timeoutMs: Number(values["timeout-ms"]) });
                rows.push(result);
                const flag = result.success ? "pass" : "FAIL";
                console.error(`${variant} r${repeat} ${task.id}: ${flag}${result.stuck.stuck ? ` stuck(${result.stuck.reasons.join(",")})` : ""}`);
            }
        }
        const prefix = model ? "model" : "scripted";
        await writeFile(join(values.out!, `${prefix}-${variant}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        all.push(...rows);
    }

    const report = renderReport(all, { title: model ? `Eval report: ${variants[0]}` : "Offline eval report (scripted agent, synthetic)" });
    const reportPath = join(values.out!, model ? `model-${variants[0]}-report.md` : "scripted-report.md");
    await writeFile(reportPath, report);
    console.log(report);
    console.error(`Wrote ${reportPath}`);
}

if (import.meta.main) await main();
