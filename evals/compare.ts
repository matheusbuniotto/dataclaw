import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveCapability, type ResolveOptions } from "../src/plugins";
import { compareEvalRuns, type CompareEvalRunsOutput } from "../src/plugins/capabilities/stats";
import { renderReport } from "./report";
import type { EpisodeResult } from "./run";
import { METRICS, UNEVEN_POLICIES, preparePaired, type MetricName, type PairedInput, type UnevenPolicy } from "./shape";

/**
 * `bun run evals:compare a.jsonl b.jsonl`: compare run B against run A through whichever
 * installed plugin provides `stats.compare_eval_runs@1` (see docs/plugins.md). Without one,
 * prints the built-in report for both runs instead.
 */

export interface CompareOptions {
    metric?: MetricName;
    uneven?: UnevenPolicy;
    variantA?: string;
    variantB?: string;
    ciMethod?: "analytic" | "cluster_bootstrap";
    alpha?: number;
    resamples?: number;
    seed?: number;
    plugins?: ResolveOptions;
}

export type CompareOutcome =
    | { kind: "plugin"; plugin: { name: string; version: string }; metric: MetricName; input: PairedInput; result: CompareEvalRunsOutput; markdown: string }
    | { kind: "builtin"; markdown: string };

const fmt = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : Number(x.toPrecision(4)).toString());

export async function compareRuns(rowsA: readonly EpisodeResult[], rowsB: readonly EpisodeResult[], options: CompareOptions = {}): Promise<CompareOutcome> {
    const metric = options.metric ?? "success";
    const input = preparePaired(rowsA, rowsB, { metric, uneven: options.uneven, variantA: options.variantA, variantB: options.variantB });
    const capability = resolveCapability(compareEvalRuns, options.plugins);
    if (!capability) {
        const note = `> No installed plugin provides ${compareEvalRuns.id}, so this is the built-in report. See docs/plugins.md to add one.\n\n`;
        return { kind: "builtin", markdown: note + renderReport([...rowsA, ...rowsB], { title: "Eval comparison (built-in report)" }) };
    }
    try {
        const result = await capability.call({
            scores_a: input.scoresA,
            scores_b: input.scoresB,
            paired: true,
            alpha: options.alpha ?? 0.05,
            ci_method: options.ciMethod ?? "cluster_bootstrap",
            ...(options.resamples !== undefined ? { n_resamples: options.resamples } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
        });
        const plugin = { name: capability.plugin.manifest.name, version: capability.plugin.manifest.version };
        return { kind: "plugin", plugin, metric, input, result, markdown: renderComparison(plugin, metric, input, result) };
    } finally {
        await capability.close();
    }
}

export function renderComparison(plugin: { name: string; version: string }, metric: string, input: PairedInput, r: CompareEvalRunsOutput): string {
    const level = r.ci_level ?? 0.95;
    const warnings = [...input.warnings, ...r.warnings];
    const lines = [
        `# Eval comparison: ${metric} (B - A)`,
        "",
        `| | A | B |`,
        `| --- | --- | --- |`,
        `| Variant | ${input.a.variants.join(", ")} | ${input.b.variants.join(", ")} |`,
        `| Mode | ${input.a.modes.join(", ")} | ${input.b.modes.join(", ")} |`,
        `| Episodes | ${input.a.episodes} | ${input.b.episodes} |`,
        `| Repeats x tasks | ${input.scoresA.length} x ${input.tasks.length} | ${input.scoresB.length} x ${input.tasks.length} |`,
        `| Successes / stuck | ${input.a.successes} / ${input.a.stuck} | ${input.b.successes} / ${input.b.stuck} |`,
        `| Mean ${metric} | ${fmt(r.mean_a)} | ${fmt(r.mean_b)} |`,
        `| Run-to-run std | ${fmt(r.run_to_run_std_a)} | ${fmt(r.run_to_run_std_b)} |`,
        "",
        `- Difference: **${fmt(r.diff)}**, ${Math.round(level * 100)}% CI [${fmt(r.ci[0])}, ${fmt(r.ci[1])}], p = ${fmt(r.pvalue)}`,
        `- Method: ${r.method}`,
        `- Computed by plugin \`${plugin.name}\` ${plugin.version} (stats.compare_eval_runs@1)`,
    ];
    if (warnings.length) lines.push("", "Warnings:", ...warnings.map((w) => `- ${w}`));
    return lines.join("\n") + "\n";
}

function readJsonl(path: string): EpisodeResult[] {
    return readFileSync(path, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as EpisodeResult);
}

if (import.meta.main) {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            metric: { type: "string", default: "success" },
            uneven: { type: "string", default: "error" },
            "variant-a": { type: "string" },
            "variant-b": { type: "string" },
            "ci-method": { type: "string", default: "cluster_bootstrap" },
            alpha: { type: "string", default: "0.05" },
            resamples: { type: "string" },
            seed: { type: "string" },
            plugin: { type: "string" },
            builtin: { type: "boolean", default: false },
            json: { type: "boolean", default: false },
        },
    });
    if (positionals.length !== 2) {
        console.error(`Usage: bun run evals:compare <a.jsonl> <b.jsonl> [--metric ${Object.keys(METRICS).join("|")}] [--uneven ${UNEVEN_POLICIES.join("|")}] [--ci-method cluster_bootstrap|analytic] [--plugin <name> | --builtin] [--json]`);
        process.exit(1);
    }
    if (!(values.metric! in METRICS)) throw new Error(`Unknown metric "${values.metric}".`);
    if (!UNEVEN_POLICIES.includes(values.uneven as UnevenPolicy)) throw new Error(`--uneven must be one of ${UNEVEN_POLICIES.join(", ")}.`);
    if (values["ci-method"] !== "analytic" && values["ci-method"] !== "cluster_bootstrap") throw new Error("--ci-method must be analytic or cluster_bootstrap.");
    const outcome = await compareRuns(readJsonl(positionals[0]!), readJsonl(positionals[1]!), {
        metric: values.metric as MetricName,
        uneven: values.uneven as UnevenPolicy,
        variantA: values["variant-a"],
        variantB: values["variant-b"],
        ciMethod: values["ci-method"],
        alpha: Number(values.alpha),
        ...(values.resamples ? { resamples: Number(values.resamples) } : {}),
        ...(values.seed ? { seed: Number(values.seed) } : {}),
        plugins: values.builtin ? { plugins: [] } : values.plugin ? { prefer: values.plugin } : {},
    });
    if (values.json && outcome.kind === "plugin") console.log(JSON.stringify({ plugin: outcome.plugin, metric: outcome.metric, tasks: outcome.input.tasks, a: outcome.input.a, b: outcome.input.b, warnings: outcome.input.warnings, result: outcome.result }, null, 2));
    else process.stdout.write(outcome.markdown);
}
