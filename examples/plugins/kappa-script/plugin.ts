/**
 * A complete `script` plugin in one file. DataClaw writes
 * `{"capability": "...", "input": {...}}` to stdin; the plugin prints `{"output": {...}}`
 * (or `{"error": "..."}`) on stdout. Enable it with
 * `DATACLAW_PLUGIN_PATH=examples/plugins/kappa-script`.
 */
import { cohensKappa, confusion, quantile, rng } from "../../../evals/stats";

interface Request {
    capability: string;
    input: { rater_a: string[]; rater_b: string[]; labels?: string[]; alpha: number; n_resamples?: number; seed?: number };
}

function agreementKappa(input: Request["input"]) {
    const { rater_a: a, rater_b: b } = input;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        throw new Error("rater_a and rater_b must be non-empty arrays of equal length");
    }
    const labels = input.labels ?? [...new Set([...a, ...b])].sort();
    const { matrix } = confusion(a, b, labels);
    const n = a.length;
    const kappa = cohensKappa(a, b, labels);
    const next = rng(input.seed ?? 3);
    const resamples = input.n_resamples ?? 2000;
    const draws: number[] = [];
    for (let i = 0; i < resamples; i++) {
        const idx = a.map(() => Math.floor(next() * n));
        const k = cohensKappa(idx.map((j) => a[j]!), idx.map((j) => b[j]!), labels);
        if (Number.isFinite(k)) draws.push(k);
    }
    const warnings: string[] = [];
    if (new Set(a).size === 1 || new Set(b).size === 1) {
        warnings.push("One rater used a single label, so kappa is 0 (or undefined) by construction and says nothing about agreement.");
    }
    const alpha = input.alpha ?? 0.05;
    return {
        kappa: Number.isFinite(kappa) ? kappa : null,
        ci: draws.length ? [quantile(draws, alpha / 2), quantile(draws, 1 - alpha / 2)] : [null, null],
        agreement: a.filter((x, i) => x === b[i]).length / n,
        confusion_matrix: matrix,
        labels,
        n,
        method: `Cohen's kappa, percentile bootstrap over items (${resamples} resamples, seed ${input.seed ?? 3})`,
        warnings,
    };
}

const request = JSON.parse(await Bun.stdin.text()) as Request;
try {
    if (request.capability !== "stats.agreement_kappa@1") throw new Error(`unsupported capability ${request.capability}`);
    console.log(JSON.stringify({ output: agreementKappa(request.input) }));
} catch (err) {
    console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
}
