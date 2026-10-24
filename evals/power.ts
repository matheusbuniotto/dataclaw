import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import type { EpisodeResult } from "./run";
import { mean, variance } from "./stats";

/**
 * Statistical Power & Sample Size Calculator for Agent Evaluations.
 *
 * Accounts for clustered data: repeat runs of the same evaluation task are
 * correlated (intra-cluster correlation, ICC). Evaluates whether an agent
 * experiment has sufficient statistical power to ship without regressions.
 */

export interface ClusteredPowerOptions {
    /** Baseline success rate (0 < p1 < 1). Default: 0.80 */
    baselineRate?: number;
    /** Minimum Detectable Effect size (e.g. 0.05 for +5 pp). Default: 0.05 */
    targetMde?: number;
    /** Type I error rate (two-sided alpha). Default: 0.05 (z = 1.96) */
    alpha?: number;
    /** Statistical power (1 - beta). Default: 0.80 (z = 0.8416) */
    power?: number;
    /** Intra-cluster correlation coefficient (0 <= rho <= 1). Default: 0.15 */
    icc?: number;
    /** Repeats per task. Default: 5 */
    repeatsPerTask?: number;
}

export interface PowerCalculationResult {
    baselineRate: number;
    targetMde: number;
    alpha: number;
    power: number;
    icc: number;
    repeatsPerTask: number;
    designEffect: number;
    effectiveSampleSizeNeeded: number;
    tasksNeeded: number;
    totalEpisodesNeeded: number;
    currentEpisodes?: number;
    isPowered?: boolean;
}

export interface ShippingDecision {
    verdict: "SHIPPABLE" | "UNDERPOWERED" | "REGRESSION_BLOCKED" | "NEUTRAL_PARITY";
    headline: string;
    explanation: string;
    recommendedActions: string[];
}

/** Standard normal quantile approximation (Abramowitz & Stegun). */
export function normalQuantile(p: number): number {
    if (p <= 0 || p >= 1) throw new RangeError(`p must be in (0, 1), got ${p}`);
    if (p === 0.5) return 0;
    const q = p > 0.5 ? 1 - p : p;
    const t = Math.sqrt(-2 * Math.log(q));
    // Rational approximation coefficients
    const c0 = 2.515517;
    const c1 = 0.802853;
    const c2 = 0.010328;
    const d1 = 1.432788;
    const d2 = 0.189269;
    const d3 = 0.001308;
    const numerator = c0 + c1 * t + c2 * t * t;
    const denominator = 1 + d1 * t + d2 * t * t + d3 * t * t * t;
    const z = t - numerator / denominator;
    return p > 0.5 ? z : -z;
}

/**
 * Estimate Intra-Cluster Correlation (ICC) from episode results.
 * Clustered by taskId.
 */
export function estimateIcc(episodes: readonly EpisodeResult[]): number {
    const byTask = new Map<string, number[]>();
    for (const ep of episodes) {
        const list = byTask.get(ep.taskId) ?? [];
        list.push(ep.success ? 1 : 0);
        byTask.set(ep.taskId, list);
    }
    const taskMeans: number[] = [];
    const taskVars: number[] = [];
    for (const scores of byTask.values()) {
        if (scores.length > 1) {
            taskMeans.push(mean(scores));
            taskVars.push(variance(scores));
        }
    }
    if (taskMeans.length < 2) return 0.15; // sensible default
    const betweenVar = variance(taskMeans);
    const withinVar = mean(taskVars);
    const totalVar = betweenVar + withinVar;
    if (totalVar <= 0) return 0;
    const rawIcc = betweenVar / totalVar;
    return Math.max(0, Math.min(1, rawIcc));
}

/**
 * Calculate required sample size (tasks and episodes) for clustered trial.
 */
export function calculateClusteredSampleSize(options: ClusteredPowerOptions = {}): PowerCalculationResult {
    const p1 = options.baselineRate ?? 0.80;
    const mde = options.targetMde ?? 0.05;
    const alpha = options.alpha ?? 0.05;
    const targetPower = options.power ?? 0.80;
    const icc = Math.max(0, Math.min(1, options.icc ?? 0.15));
    const m = Math.max(1, options.repeatsPerTask ?? 5);

    const zAlpha = normalQuantile(1 - alpha / 2);
    const zBeta = normalQuantile(targetPower);

    const p2 = Math.min(0.999, Math.max(0.001, p1 + mde));
    const pooledVariance = p1 * (1 - p1) + p2 * (1 - p2);

    // Standard unclustered N per variant
    const nEff = Math.ceil(((zAlpha + zBeta) ** 2 * pooledVariance) / (mde * mde));

    // Design effect (VIF) due to clustering
    const designEffect = 1 + (m - 1) * icc;

    // Total episodes needed per variant
    const totalEpisodes = Math.ceil(nEff * designEffect);

    // Number of distinct tasks required
    const tasksNeeded = Math.ceil(totalEpisodes / m);

    return {
        baselineRate: p1,
        targetMde: mde,
        alpha,
        power: targetPower,
        icc,
        repeatsPerTask: m,
        designEffect,
        effectiveSampleSizeNeeded: nEff,
        tasksNeeded,
        totalEpisodesNeeded: tasksNeeded * m,
    };
}

/**
 * Calculate Minimum Detectable Effect (MDE) given a fixed task and repeat budget.
 */
export function calculateMde(
    tasks: number,
    repeats: number,
    baselineRate = 0.80,
    icc = 0.15,
    alpha = 0.05,
    power = 0.80,
): number {
    const totalN = tasks * repeats;
    const designEffect = 1 + (repeats - 1) * icc;
    const effectiveN = totalN / designEffect;

    const zAlpha = normalQuantile(1 - alpha / 2);
    const zBeta = normalQuantile(power);

    // Approximate MDE solving quadratic or standard variance
    const mde = (zAlpha + zBeta) * Math.sqrt((2 * baselineRate * (1 - baselineRate)) / effectiveN);
    return Math.min(1.0, mde);
}

/**
 * Evaluate whether an agent change is shippable based on statistical significance,
 * observed effect size, and whether the test was sufficiently powered.
 */
export function evaluateShippingDecision(
    observedDiff: number,
    ciLow: number,
    ciHigh: number,
    pValue: number,
    tasksCount: number,
    repeatsCount: number,
    options: ClusteredPowerOptions = {},
): ShippingDecision {
    const mde = options.targetMde ?? 0.05;
    const alpha = options.alpha ?? 0.05;
    const currentMde = calculateMde(tasksCount, repeatsCount, options.baselineRate ?? 0.80, options.icc ?? 0.15, alpha);

    // 1. Regression check: significantly worse
    if (ciHigh < 0 || (pValue < alpha && observedDiff < 0)) {
        return {
            verdict: "REGRESSION_BLOCKED",
            headline: `Do Not Ship: Statistically Significant Regression (${(observedDiff * 100).toFixed(1)} pp)`,
            explanation: `The candidate variant degraded success rate with 95% CI [${(ciLow * 100).toFixed(1)} pp, ${(ciHigh * 100).toFixed(1)} pp], p = ${pValue.toFixed(4)}.`,
            recommendedActions: [
                "Block deployment immediately.",
                "Inspect trace logs for error spikes and stuck loops.",
                "Verify prompt changes against baseline failure modes.",
            ],
        };
    }

    // 2. Clear winner: significantly better and well-powered
    if (ciLow > 0 && observedDiff >= mde) {
        return {
            verdict: "SHIPPABLE",
            headline: `Ready to Ship: Statistically Significant Uplift (+${(observedDiff * 100).toFixed(1)} pp)`,
            explanation: `Candidate demonstrates robust improvement above MDE target (+${(mde * 100).toFixed(1)} pp) with 95% CI [${(ciLow * 100).toFixed(1)} pp, ${(ciHigh * 100).toFixed(1)} pp], p = ${pValue.toFixed(4)}.`,
            recommendedActions: [
                "Proceed with phased rollout (canary release).",
                "Monitor production stuck rate and token consumption.",
                "Commit playbook rules distilled from this eval run.",
            ],
        };
    }

    // 3. Underpowered: difference not significant, but current study couldn't detect target MDE
    if (currentMde > mde) {
        return {
            verdict: "UNDERPOWERED",
            headline: `Inconclusive: Test Underpowered (Current MDE: ±${(currentMde * 100).toFixed(1)} pp > Target ±${(mde * 100).toFixed(1)} pp)`,
            explanation: `Observed difference is ${(observedDiff >= 0 ? "+" : "")}${(observedDiff * 100).toFixed(1)} pp (CI [${(ciLow * 100).toFixed(1)} pp, ${(ciHigh * 100).toFixed(1)} pp], p = ${pValue.toFixed(4)}). However, ${tasksCount} tasks × ${repeatsCount} repeats has insufficient power to reliably distinguish true signal from noise for effect sizes below ±${(currentMde * 100).toFixed(1)} pp.`,
            recommendedActions: [
                `Expand eval dataset: current setup has ${tasksCount} tasks; power analysis requires ≥ ${calculateClusteredSampleSize({ ...options, targetMde: mde }).tasksNeeded} tasks.`,
                "Do not make ship/kill decisions based on underpowered noise.",
                "Review stuck rate and latency: if stuck rate dropped dramatically with zero regressions, consider canary testing.",
            ],
        };
    }

    // 4. Neutral / Non-inferior
    return {
        verdict: "NEUTRAL_PARITY",
        headline: `Neutral Performance: Parity Verified (±${(currentMde * 100).toFixed(1)} pp bounds)`,
        explanation: `Candidate shows no statistically significant divergence from baseline within tight bounds. Safe to ship if candidate delivers secondary benefits (e.g. lower token cost or latency).`,
        recommendedActions: [
            "Check secondary metrics: token cost per success and latency.",
            "If cost/latency is lower, ship candidate as an efficiency optimization.",
            "Otherwise, maintain baseline variant.",
        ],
    };
}

/** Render a comprehensive Markdown power report. */
export function renderPowerReport(
    currentTasks: number,
    currentRepeats: number,
    icc = 0.15,
    baselineRate = 0.80,
): string {
    const mde5 = calculateClusteredSampleSize({ baselineRate, targetMde: 0.05, icc, repeatsPerTask: currentRepeats });
    const mde10 = calculateClusteredSampleSize({ baselineRate, targetMde: 0.10, icc, repeatsPerTask: currentRepeats });
    const mde15 = calculateClusteredSampleSize({ baselineRate, targetMde: 0.15, icc, repeatsPerTask: currentRepeats });

    const currentMde = calculateMde(currentTasks, currentRepeats, baselineRate, icc);

    const lines = [
        "# Agent Experiment Power Analysis & Shipping Gate",
        "",
        "> Determining whether agent evaluations have adequate statistical power (1 - β = 0.80, α = 0.05)",
        "> to reliably distinguish true model/prompt improvements from noisy runs under task clustering.",
        "",
        "## Current Experiment Power State",
        "",
        `| Parameter | Value | Note |`,
        `| :--- | :--- | :--- |`,
        `| Current Tasks | **${currentTasks}** | Distinct eval questions / golden set |`,
        `| Repeats per Task | **${currentRepeats}** | Clustered repetitions per question |`,
        `| Total Episodes per Variant | **${currentTasks * currentRepeats}** | Total runs executed |`,
        `| Baseline Success Rate ($p_1$) | **${(baselineRate * 100).toFixed(1)}%** | Control variant success rate |`,
        `| Intra-Cluster Correlation (ICC) | **${icc.toFixed(3)}** | Correlation across task repeats |`,
        `| Design Effect (VIF) | **${(1 + (currentRepeats - 1) * icc).toFixed(2)}x** | Variance inflation from task clustering |`,
        `| **Minimum Detectable Effect (MDE)** | **±${(currentMde * 100).toFixed(1)} pp** | **Smallest detectable gain with 80% power** |`,
        "",
        "## Sample Size Matrix: Requirements by Target MDE",
        "",
        `To detect gains with **80% statistical power** and **α = 0.05** (two-sided), you need:`,
        "",
        `| Target MDE | Effective $N$ | Design Effect | Tasks Needed ($m=${currentRepeats}$) | Total Episodes | Can Current Setup Detect? |`,
        `| :--- | :--- | :--- | :--- | :--- | :--- |`,
        `| **+5.0 pp** ($p_2 = ${(mde5.baselineRate + 0.05) * 100}%$) | ${mde5.effectiveSampleSizeNeeded} | ${mde5.designEffect.toFixed(2)}x | **${mde5.tasksNeeded} tasks** | ${mde5.totalEpisodesNeeded} | ${currentTasks >= mde5.tasksNeeded ? "✅ Yes" : "❌ Underpowered (needs " + mde5.tasksNeeded + " tasks)"} |`,
        `| **+10.0 pp** ($p_2 = ${(mde10.baselineRate + 0.10) * 100}%$) | ${mde10.effectiveSampleSizeNeeded} | ${mde10.designEffect.toFixed(2)}x | **${mde10.tasksNeeded} tasks** | ${mde10.totalEpisodesNeeded} | ${currentTasks >= mde10.tasksNeeded ? "✅ Yes" : "❌ Underpowered (needs " + mde10.tasksNeeded + " tasks)"} |`,
        `| **+15.0 pp** ($p_2 = ${(mde15.baselineRate + 0.15) * 100}%$) | ${mde15.effectiveSampleSizeNeeded} | ${mde15.designEffect.toFixed(2)}x | **${mde15.tasksNeeded} tasks** | ${mde15.totalEpisodesNeeded} | ${currentTasks >= mde15.tasksNeeded ? "✅ Yes" : "❌ Underpowered (needs " + mde15.tasksNeeded + " tasks)"} |`,
        "",
        "## Key Takeaways for Agent Shipping",
        "",
        `- **Why Clustered Bootstrap Matters**: With repeats ($m=${currentRepeats}$), episodes on the same task are not independent. Treating them as independent underestimates variance by **${(1 + (currentRepeats - 1) * icc).toFixed(2)}x**, leading to false-positive ship decisions.`,
        `- **Actionable Rule**: A test with ${currentTasks} tasks can only detect large swings (±${(currentMde * 100).toFixed(1)} pp). To detect a subtle +5 pp improvement before shipping a core model/prompt change, expand the golden task benchmark to **${mde5.tasksNeeded} tasks**.`,
        `- **Alternative Strategy**: Use high-sensitivity continuous proxy metrics (e.g. stuck-rate reduction or query-error rate) which exhibit higher statistical power at smaller sample sizes.`,
    ];

    return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------

async function main() {
    const { values } = parseArgs({
        options: {
            tasks: { type: "string", default: "9" },
            repeats: { type: "string", default: "5" },
            icc: { type: "string", default: "0.15" },
            baseline: { type: "string", default: "0.80" },
            results: { type: "string" },
        },
    });

    let currentTasks = parseInt(values.tasks ?? "9", 10);
    let currentRepeats = parseInt(values.repeats ?? "5", 10);
    let icc = parseFloat(values.icc ?? "0.15");
    let baseline = parseFloat(values.baseline ?? "0.80");

    if (values.results && existsSync(values.results)) {
        const raw = readFileSync(values.results, "utf-8");
        const episodes = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as EpisodeResult);
        const taskIds = new Set(episodes.map((e) => e.taskId));
        currentTasks = taskIds.size;
        currentRepeats = Math.round(episodes.length / currentTasks);
        icc = estimateIcc(episodes);
        baseline = mean(episodes.map((e) => (e.success ? 1 : 0)));
    }

    const report = renderPowerReport(currentTasks, currentRepeats, icc, baseline);
    console.log(report);
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
