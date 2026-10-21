import { readFileSync } from "node:fs";
import type { EpisodeResult } from "./run";
import { clusterBootstrap, cohensH, mean, proportionDifference, quantile, sampleRatioMismatch, variance, wilson, type Interval } from "./stats";

type Rows = readonly EpisodeResult[];

const byTask = (rows: Rows): EpisodeResult[][] => {
    const groups = new Map<string, EpisodeResult[]>();
    for (const row of rows) groups.set(row.taskId, [...(groups.get(row.taskId) ?? []), row]);
    return [...groups.values()];
};

const rate = (rows: Rows, pick: (r: EpisodeResult) => boolean) => (rows.length ? rows.filter(pick).length / rows.length : NaN);
const costPerSuccess = (rows: Rows) => {
    const wins = rows.filter((r) => r.success).length;
    return wins === 0 ? NaN : rows.reduce((s, r) => s + r.costUsd, 0) / wins;
};

export interface VariantSummary {
    variant: string;
    episodes: number;
    tasks: number;
    repeats: number;
    success: Interval;
    /** Share of tasks solved in every repeat (consistency), and in at least one repeat. */
    passAll: number;
    passAny: number;
    /** Success rate of each full pass over the task set, to show run-to-run spread. */
    successByRepeat: number[];
    flakyTasks: string[];
    stuck: Interval;
    stuckReasons: Record<string, number>;
    successGivenStuck: number;
    successGivenNotStuck: number;
    shippedRejected: number;
    toolCallsPerEpisode: number;
    toolErrorRate: number;
    tokensPerEpisode: number;
    costPerSuccess: Interval;
    costSource: string;
    latencyP50: number;
    latencyP90: number;
}

export function summarize(rows: Rows, seed = 7): VariantSummary {
    const clusters = byTask(rows);
    const repeats = [...new Set(rows.map((r) => r.repeat))].sort((a, b) => a - b);
    const reasons: Record<string, number> = {};
    for (const row of rows) for (const reason of row.stuck.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const stuckRows = rows.filter((r) => r.stuck.stuck);
    const calls = rows.reduce((s, r) => s + r.toolCalls, 0);
    return {
        variant: rows[0]?.variant ?? "?",
        episodes: rows.length,
        tasks: clusters.length,
        repeats: repeats.length,
        success: clusterBootstrap(clusters, (rs) => rate(rs, (r) => r.success), { seed }),
        passAll: rate(clusters.map((c) => c[0]!), (first) => clusters.find((c) => c[0] === first)!.every((r) => r.success)),
        passAny: rate(clusters.map((c) => c[0]!), (first) => clusters.find((c) => c[0] === first)!.some((r) => r.success)),
        successByRepeat: repeats.map((k) => rate(rows.filter((r) => r.repeat === k), (r) => r.success)),
        flakyTasks: clusters.filter((c) => c.some((r) => r.success) && c.some((r) => !r.success)).map((c) => c[0]!.taskId),
        stuck: clusterBootstrap(clusters, (rs) => rate(rs, (r) => r.stuck.stuck), { seed }),
        stuckReasons: reasons,
        successGivenStuck: rate(stuckRows, (r) => r.success),
        successGivenNotStuck: rate(rows.filter((r) => !r.stuck.stuck), (r) => r.success),
        shippedRejected: rate(rows, (r) => r.stuck.shippedRejectedFinding),
        toolCallsPerEpisode: calls / rows.length,
        toolErrorRate: calls ? rows.reduce((s, r) => s + r.toolErrors, 0) / calls : NaN,
        tokensPerEpisode: mean(rows.map((r) => r.tokens.total)),
        costPerSuccess: clusterBootstrap(clusters, costPerSuccess, { seed }),
        costSource: [...new Set(rows.map((r) => r.costSource))].join("+"),
        latencyP50: quantile(rows.map((r) => r.latencyMs), 0.5),
        latencyP90: quantile(rows.map((r) => r.latencyMs), 0.9),
    };
}

export interface Comparison {
    control: string;
    treatment: string;
    srm: ReturnType<typeof sampleRatioMismatch>;
    successDiff: Interval;
    successDiffBootstrap: Interval;
    cohensH: number;
    stuckDiff: Interval;
    costPerSuccessDiff: Interval;
}

/**
 * Compare two variants run on the same task set. Intervals resample tasks, with both arms kept
 * together per task, because the arms share tasks and task difficulty dominates the variance.
 */
export function compare(control: Rows, treatment: Rows, seed = 11): Comparison {
    const a = control.filter((r) => r.success).length;
    const b = treatment.filter((r) => r.success).length;
    const pa = a / control.length;
    const pb = b / treatment.length;
    const taskIds = [...new Set([...control, ...treatment].map((r) => r.taskId))];
    const paired = taskIds.map((id) => [...control.filter((r) => r.taskId === id), ...treatment.filter((r) => r.taskId === id)]);
    const controlName = control[0]?.variant ?? "control";
    const diff = (stat: (rows: Rows) => number) => (rows: Rows) =>
        stat(rows.filter((r) => r.variant !== controlName)) - stat(rows.filter((r) => r.variant === controlName));
    return {
        control: controlName,
        treatment: treatment[0]?.variant ?? "treatment",
        srm: sampleRatioMismatch([control.length, treatment.length], [1, 1]),
        successDiff: proportionDifference(a, control.length, b, treatment.length),
        successDiffBootstrap: clusterBootstrap(paired, diff((rs) => rate(rs, (r) => r.success)), { seed }),
        cohensH: cohensH(pa, pb),
        stuckDiff: clusterBootstrap(paired, diff((rs) => rate(rs, (r) => r.stuck.stuck)), { seed }),
        costPerSuccessDiff: clusterBootstrap(paired, diff(costPerSuccess), { seed }),
    };
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const ci = (i: Interval, f: (x: number) => string) => `${f(i.estimate)} [${f(i.low)}, ${f(i.high)}]`;
const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(5)}` : "n/a");
const pp = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp` : "n/a");

export function renderReport(rows: Rows, options: { title: string }): string {
    const variants = [...new Set(rows.map((r) => r.variant))];
    const summaries = variants.map((v) => summarize(rows.filter((r) => r.variant === v)));
    const scripted = rows.some((r) => r.mode === "scripted");
    const lines: string[] = [`# ${options.title}`, ""];
    if (scripted) {
        lines.push(
            "> Synthetic data. These episodes ran the real harness, tools, and SQLite engine, but the model was a",
            "> scripted agent with failures injected at fixed rates (`evals/scripted-agent.ts`). The numbers check",
            "> the measurement pipeline; they say nothing about the quality of any model. Costs use a nominal price.",
            "",
        );
    }
    const row = (label: string, f: (s: VariantSummary) => string) => `| ${label} | ${summaries.map(f).join(" | ")} |`;
    lines.push(
        `| Metric | ${summaries.map((s) => s.variant).join(" | ")} |`,
        `| --- | ${summaries.map(() => "---").join(" | ")} |`,
        row("Episodes (tasks × repeats)", (s) => `${s.episodes} (${s.tasks} × ${s.repeats})`),
        row("Success rate [95% CI]", (s) => ci(s.success, pct)),
        row("Tasks solved in every repeat", (s) => pct(s.passAll)),
        row("Tasks solved in any repeat", (s) => pct(s.passAny)),
        row("Success by repeat (min–max, sd)", (s) =>
            `${pct(Math.min(...s.successByRepeat))}–${pct(Math.max(...s.successByRepeat))}, sd ${pct(Math.sqrt(variance(s.successByRepeat)))}`),
        row("Flaky tasks", (s) => String(s.flakyTasks.length)),
        row("Stuck rate [95% CI]", (s) => ci(s.stuck, pct)),
        row("Stuck reasons", (s) => Object.entries(s.stuckReasons).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"),
        row("Success when stuck / not stuck", (s) => `${pct(s.successGivenStuck)} / ${pct(s.successGivenNotStuck)}`),
        row("Answered despite a rejected finding", (s) => pct(s.shippedRejected)),
        row("Tool calls per episode", (s) => s.toolCallsPerEpisode.toFixed(1)),
        row("Tool error rate", (s) => pct(s.toolErrorRate)),
        row("Tokens per episode", (s) => Math.round(s.tokensPerEpisode).toLocaleString("en-US")),
        row("Cost per success [95% CI]", (s) => `${ci(s.costPerSuccess, usd)} (${s.costSource})`),
        row("Latency p50 / p90", (s) => `${Math.round(s.latencyP50)} ms / ${Math.round(s.latencyP90)} ms`),
        "",
        "CIs are percentile bootstraps that resample tasks (2,000 draws), since repeats of one task are correlated.",
        "Latency is wall clock on the machine that ran the evals and is not reproducible run to run.",
    );

    if (variants.length === 2) {
        const c = compare(rows.filter((r) => r.variant === variants[0]), rows.filter((r) => r.variant === variants[1]));
        lines.push(
            "",
            `## ${c.treatment} vs ${c.control}`,
            "",
            `| Check | Result |`,
            `| --- | --- |`,
            `| Sample ratio (planned 1:1) | ${c.srm.observed.join(" vs ")}, χ² = ${c.srm.chiSquare.toFixed(2)}, p = ${c.srm.pValue.toFixed(3)}${c.srm.mismatch ? " **SRM: do not trust this comparison**" : ""} |`,
            `| Success difference, Newcombe 95% CI | ${pp(c.successDiff.estimate)} [${pp(c.successDiff.low)}, ${pp(c.successDiff.high)}] |`,
            `| Success difference, task bootstrap 95% CI | ${pp(c.successDiffBootstrap.estimate)} [${pp(c.successDiffBootstrap.low)}, ${pp(c.successDiffBootstrap.high)}] |`,
            `| Effect size (Cohen's h) | ${c.cohensH.toFixed(2)} |`,
            `| Stuck rate difference, task bootstrap 95% CI | ${pp(c.stuckDiff.estimate)} [${pp(c.stuckDiff.low)}, ${pp(c.stuckDiff.high)}] |`,
            `| Cost per success difference, task bootstrap 95% CI | ${usd(c.costPerSuccessDiff.estimate)} [${usd(c.costPerSuccessDiff.low)}, ${usd(c.costPerSuccessDiff.high)}] |`,
            "",
            "The Newcombe interval treats episodes as independent; the task bootstrap does not, and is the one to read.",
        );
    }
    return lines.join("\n") + "\n";
}

function readJsonl(path: string): EpisodeResult[] {
    return readFileSync(path, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as EpisodeResult);
}

if (import.meta.main) {
    const paths = process.argv.slice(2);
    if (paths.length === 0) {
        console.error("Usage: bun run evals:report <results.jsonl> [<other.jsonl>]");
        process.exit(1);
    }
    const rows = paths.flatMap(readJsonl);
    console.log(renderReport(rows, { title: `Eval report: ${paths.join(" vs ")}` }));
}
