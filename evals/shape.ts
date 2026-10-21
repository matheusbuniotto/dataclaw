import type { EpisodeResult } from "./run";

/**
 * Turn episode records into the plain `runs x cases` matrices a stats plugin receives.
 * A case is a task (`taskId`), a run is a repeat (`repeat`).
 */

export const METRICS = {
    success: (e: EpisodeResult) => (e.success ? 1 : 0),
    stuck: (e: EpisodeResult) => (e.stuck.stuck ? 1 : 0),
    cost_usd: (e: EpisodeResult) => e.costUsd,
    latency_ms: (e: EpisodeResult) => e.latencyMs,
    tokens_total: (e: EpisodeResult) => e.tokens.total,
    tool_calls: (e: EpisodeResult) => e.toolCalls,
    tool_errors: (e: EpisodeResult) => e.toolErrors,
} as const;
export type MetricName = keyof typeof METRICS;

/**
 * What to do when a task lacks some repeats:
 * - `error`: refuse, naming the tasks (default).
 * - `drop_tasks`: leave those tasks out (with a warning).
 * - `truncate`: keep the first k repeats of every task, k = the smallest count (with a warning).
 */
export type UnevenPolicy = "error" | "drop_tasks" | "truncate";
export const UNEVEN_POLICIES: readonly UnevenPolicy[] = ["error", "drop_tasks", "truncate"];

export interface Matrix {
    /** `scores[r][j]`: repeat r of task j. */
    scores: number[][];
    tasks: string[];
    warnings: string[];
}

export function episodesToMatrix(rows: readonly EpisodeResult[], metric: MetricName, uneven: UnevenPolicy = "error", label = "episodes"): Matrix {
    const pick = METRICS[metric];
    if (!pick) throw new Error(`Unknown metric "${metric}". Use one of: ${Object.keys(METRICS).join(", ")}.`);
    const byTask = new Map<string, Map<number, number>>();
    for (const row of rows) {
        const reps = byTask.get(row.taskId) ?? new Map<number, number>();
        if (reps.has(row.repeat)) throw new Error(`${label}: duplicate episode for task "${row.taskId}" repeat ${row.repeat}.`);
        reps.set(row.repeat, pick(row));
        byTask.set(row.taskId, reps);
    }
    const allRepeats = [...new Set(rows.map((r) => r.repeat))].sort((a, b) => a - b);
    let tasks = [...byTask.keys()].sort();
    const incomplete = tasks
        .map((t) => ({ task: t, missing: allRepeats.filter((r) => !byTask.get(t)!.has(r)) }))
        .filter((x) => x.missing.length > 0);
    const warnings: string[] = [];
    const detail = incomplete.map((x) => `${x.task} (missing repeats ${x.missing.join(", ")})`).join("; ");
    if (incomplete.length > 0 && uneven === "error") {
        throw new Error(`${label}: uneven repeats: ${detail}. Use --uneven drop_tasks or --uneven truncate.`);
    }
    if (incomplete.length > 0 && uneven === "drop_tasks") {
        const drop = new Set(incomplete.map((x) => x.task));
        tasks = tasks.filter((t) => !drop.has(t));
        warnings.push(`${label}: dropped tasks with incomplete repeats: ${detail}`);
    }
    if (tasks.length < 2) throw new Error(`${label}: need at least 2 tasks with complete repeats.`);
    if (incomplete.length > 0 && uneven === "truncate") {
        const k = Math.min(...tasks.map((t) => byTask.get(t)!.size));
        const dropped = tasks.reduce((s, t) => s + byTask.get(t)!.size - k, 0);
        warnings.push(`${label}: uneven repeats (${detail}); kept the first ${k} repeat(s) of every task, dropped ${dropped} episode(s)`);
        const columns = tasks.map((t) => [...byTask.get(t)!.entries()].sort((a, b) => a[0] - b[0]).slice(0, k).map(([, v]) => v));
        return { scores: Array.from({ length: k }, (_, r) => columns.map((c) => c[r]!)), tasks, warnings };
    }
    return { scores: allRepeats.map((r) => tasks.map((t) => byTask.get(t)!.get(r)!)), tasks, warnings };
}

export interface SideSummary {
    variants: string[];
    models: string[];
    modes: string[];
    episodes: number;
    successes: number;
    stuck: number;
    errors: Record<string, number>;
    costSources: string[];
}

export function summarizeSide(rows: readonly EpisodeResult[]): SideSummary {
    const errors: Record<string, number> = {};
    for (const r of rows) if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
    const uniq = (f: (r: EpisodeResult) => string) => [...new Set(rows.map(f))].sort();
    return {
        variants: uniq((r) => r.variant),
        models: uniq((r) => r.model),
        modes: uniq((r) => r.mode),
        episodes: rows.length,
        successes: rows.filter((r) => r.success).length,
        stuck: rows.filter((r) => r.stuck.stuck).length,
        errors,
        costSources: uniq((r) => r.costSource),
    };
}

export interface PairedInput {
    scoresA: number[][];
    scoresB: number[][];
    tasks: string[];
    a: SideSummary;
    b: SideSummary;
    warnings: string[];
}

/** Pick one variant per side, keep shared tasks, shape both matrices, and collect warnings. */
export function preparePaired(
    rowsA: readonly EpisodeResult[],
    rowsB: readonly EpisodeResult[],
    options: { metric: MetricName; uneven?: UnevenPolicy; variantA?: string; variantB?: string },
): PairedInput {
    const pickVariant = (rows: readonly EpisodeResult[], variant: string | undefined, label: string) => {
        const variants = [...new Set(rows.map((r) => r.variant))].sort();
        if (variant !== undefined) {
            const chosen = rows.filter((r) => r.variant === variant);
            if (chosen.length === 0) throw new Error(`${label}: variant "${variant}" not found (have ${variants.join(", ")}).`);
            return chosen;
        }
        if (variants.length > 1) throw new Error(`${label}: several variants (${variants.join(", ")}); pass --variant-${label.toLowerCase()}.`);
        return rows;
    };
    let a = pickVariant(rowsA, options.variantA, "A");
    let b = pickVariant(rowsB, options.variantB, "B");
    const warnings: string[] = [];
    const tasksA = new Set(a.map((r) => r.taskId));
    const tasksB = new Set(b.map((r) => r.taskId));
    const shared = [...tasksA].filter((t) => tasksB.has(t));
    if (shared.length < 2) throw new Error(`A and B share ${shared.length} task(s); a paired comparison needs at least 2.`);
    if (shared.length !== tasksA.size || shared.length !== tasksB.size) {
        const onlyA = [...tasksA].filter((t) => !tasksB.has(t)).sort();
        const onlyB = [...tasksB].filter((t) => !tasksA.has(t)).sort();
        warnings.push(`Tasks only in A: [${onlyA.join(", ")}], only in B: [${onlyB.join(", ")}]; compared on the ${shared.length} shared tasks.`);
    }
    const keep = new Set(shared);
    a = a.filter((r) => keep.has(r.taskId));
    b = b.filter((r) => keep.has(r.taskId));
    let ma = episodesToMatrix(a, options.metric, options.uneven, "A");
    let mb = episodesToMatrix(b, options.metric, options.uneven, "B");
    warnings.push(...ma.warnings, ...mb.warnings);
    if (ma.tasks.join("|") !== mb.tasks.join("|")) {
        const common = ma.tasks.filter((t) => mb.tasks.includes(t));
        if (common.length < 2) throw new Error("After dropping incomplete tasks, fewer than 2 tasks are shared.");
        const project = (m: Matrix) => ({ ...m, scores: m.scores.map((row) => common.map((t) => row[m.tasks.indexOf(t)]!)), tasks: common });
        ma = project(ma);
        mb = project(mb);
        warnings.push(`After dropping incomplete tasks, compared on ${common.length} tasks.`);
    }
    const sa = summarizeSide(a);
    const sb = summarizeSide(b);
    for (const [label, s] of [["A", sa], ["B", sb]] as const) {
        if (s.modes.includes("scripted")) {
            warnings.push(`${label} contains mode=scripted episodes: the offline scripted agent with injected failure rates, not a real model. The difference says nothing about model quality.`);
        }
        const nErr = Object.values(s.errors).reduce((x, y) => x + y, 0);
        if (nErr > 0) warnings.push(`${label}: ${nErr} episode(s) recorded an error: ${Object.entries(s.errors).map(([k, v]) => `${k} x${v}`).join(", ")}.`);
    }
    if (options.metric === "cost_usd" && [...sa.costSources, ...sb.costSources].includes("nominal")) {
        warnings.push("cost_usd includes nominal prices (scripted runs), not provider-billed cost; the comparison is not like for like.");
    }
    return { scoresA: ma.scores, scoresB: mb.scores, tasks: ma.tasks, a: sa, b: sb, warnings };
}
