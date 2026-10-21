/**
 * Stats capability contracts, version 1. Documented in docs/capabilities/stats.md.
 * Plugins receive plain arrays; DataClaw does all shaping of its own records.
 */
import type { CapabilityContract } from "../registry";

type Bounds = [number | null, number | null];

export interface CompareEvalRunsInput {
    /** runs x cases: `scores_a[r][j]` is run r of case j. Same case order in A and B. */
    scores_a: number[][];
    scores_b: number[][];
    /** Cases are the same items in A and B (pair by case). */
    paired: boolean;
    alpha: number;
    /** `analytic` is required of every provider; `cluster_bootstrap` is optional. */
    ci_method: "analytic" | "cluster_bootstrap";
    n_resamples?: number;
    seed?: number;
}

export interface CompareEvalRunsOutput {
    /** mean_b - mean_a */
    diff: number;
    ci: [number, number];
    pvalue: number | null;
    run_to_run_std_a: number | null;
    run_to_run_std_b: number | null;
    method: string;
    warnings: string[];
    mean_a?: number;
    mean_b?: number;
    ci_level?: number;
    n_cases?: number | Record<string, number>;
    n_runs?: number | Record<string, number>;
}

export interface AgreementKappaInput {
    /** One label per item; `rater_a[i]` and `rater_b[i]` label the same item. */
    rater_a: string[];
    rater_b: string[];
    /** Category order for the confusion matrix. Default: sorted union of both raters. */
    labels?: string[];
    alpha: number;
    n_resamples?: number;
    seed?: number;
}

export interface AgreementKappaOutput {
    /** Cohen's kappa; null when undefined (expected agreement is 1). */
    kappa: number | null;
    ci: Bounds;
    /** Raw share of items where the raters agree. */
    agreement: number;
    /** Rows = rater_a, columns = rater_b, both in `labels` order. */
    confusion_matrix: number[][];
    labels: string[];
    n: number;
    method: string;
    warnings: string[];
    kappa_se?: number | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || isNum(v);

function obj(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected a JSON object");
    return raw as Record<string, unknown>;
}

function need(o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean, what: string) {
    if (!ok(o[key])) throw new Error(`"${key}" must be ${what}, got ${JSON.stringify(o[key])}`);
}

const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
const pair = (ok: (x: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(ok);

export const compareEvalRuns: CapabilityContract<CompareEvalRunsInput, CompareEvalRunsOutput> = {
    id: "stats.compare_eval_runs@1",
    toInput: (i) => ({
        scores_a: i.scores_a,
        scores_b: i.scores_b,
        paired: i.paired,
        alpha: i.alpha,
        ci_method: i.ci_method,
        ...(i.n_resamples !== undefined ? { n_resamples: i.n_resamples } : {}),
        ...(i.seed !== undefined ? { seed: i.seed } : {}),
    }),
    parseOutput(raw) {
        const o = obj(raw);
        need(o, "diff", isNum, "a finite number");
        need(o, "ci", pair(isNum), "[low, high]");
        need(o, "pvalue", numOrNull, "a number or null");
        need(o, "run_to_run_std_a", numOrNull, "a number or null");
        need(o, "run_to_run_std_b", numOrNull, "a number or null");
        need(o, "method", (v) => typeof v === "string", "a string");
        need(o, "warnings", strings, "an array of strings");
        return o as unknown as CompareEvalRunsOutput;
    },
};

export const agreementKappa: CapabilityContract<AgreementKappaInput, AgreementKappaOutput> = {
    id: "stats.agreement_kappa@1",
    toInput: (i) => ({
        rater_a: i.rater_a,
        rater_b: i.rater_b,
        alpha: i.alpha,
        ...(i.labels ? { labels: i.labels } : {}),
        ...(i.n_resamples !== undefined ? { n_resamples: i.n_resamples } : {}),
        ...(i.seed !== undefined ? { seed: i.seed } : {}),
    }),
    parseOutput(raw) {
        const o = obj(raw);
        need(o, "kappa", numOrNull, "a number or null");
        need(o, "ci", pair(numOrNull), "[low, high] (numbers or null)");
        need(o, "agreement", isNum, "a finite number");
        need(o, "labels", strings, "an array of strings");
        const k = (o.labels as string[]).length;
        need(o, "confusion_matrix", (v) => Array.isArray(v) && v.length === k && v.every((r) => Array.isArray(r) && r.length === k && r.every(isNum)), `a ${k}x${k} number matrix`);
        need(o, "n", isNum, "a number");
        need(o, "method", (v) => typeof v === "string", "a string");
        need(o, "warnings", strings, "an array of strings");
        return o as unknown as AgreementKappaOutput;
    },
};

export const STATS_CAPABILITIES = [compareEvalRuns.id, agreementKappa.id] as const;
