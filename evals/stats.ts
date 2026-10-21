/**
 * Small, dependency-free statistics for eval and experiment reports.
 * Every resampling function takes an explicit seed so reports are reproducible.
 */

export interface Interval {
    estimate: number;
    low: number;
    high: number;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Stable 32-bit hash of a string, for deriving per-episode seeds. */
export function hashSeed(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function mean(xs: readonly number[]): number {
    return xs.length === 0 ? NaN : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function variance(xs: readonly number[]): number {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

export function quantile(xs: readonly number[], q: number): number {
    if (xs.length === 0) return NaN;
    const sorted = [...xs].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Wilson score interval for a binomial proportion. */
export function wilson(successes: number, n: number, z = 1.96): Interval {
    if (n === 0) return { estimate: NaN, low: NaN, high: NaN };
    const p = successes / n;
    const denom = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    return { estimate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * Percentile bootstrap over clusters. Repeated runs of the same eval task are correlated,
 * so the unit we resample is the task (cluster), not the individual run.
 */
export function clusterBootstrap<T>(
    clusters: readonly (readonly T[])[],
    statistic: (rows: readonly T[]) => number,
    options: { iterations?: number; seed?: number; alpha?: number } = {},
): Interval {
    const iterations = options.iterations ?? 2000;
    const alpha = options.alpha ?? 0.05;
    const next = rng(options.seed ?? 1);
    const estimate = statistic(clusters.flat());
    if (clusters.length === 0) return { estimate: NaN, low: NaN, high: NaN };
    const draws: number[] = [];
    for (let i = 0; i < iterations; i++) {
        const sample: T[] = [];
        for (let j = 0; j < clusters.length; j++) {
            sample.push(...clusters[Math.floor(next() * clusters.length)]!);
        }
        const value = statistic(sample);
        if (Number.isFinite(value)) draws.push(value);
    }
    return { estimate, low: quantile(draws, alpha / 2), high: quantile(draws, 1 - alpha / 2) };
}

/** Upper tail of the chi-square distribution (regularized upper incomplete gamma). */
export function chiSquarePValue(statistic: number, df: number): number {
    if (statistic <= 0) return 1;
    return upperGamma(df / 2, statistic / 2);
}

function upperGamma(s: number, x: number): number {
    // Series for P(s, x) when x < s + 1, continued fraction for Q(s, x) otherwise (Numerical Recipes 6.2).
    const lnGammaS = lnGamma(s);
    if (x < s + 1) {
        let sum = 1 / s;
        let term = sum;
        for (let n = 1; n < 500; n++) {
            term *= x / (s + n);
            sum += term;
            if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
        }
        return 1 - sum * Math.exp(-x + s * Math.log(x) - lnGammaS);
    }
    let b = x + 1 - s;
    let c = 1 / 1e-300;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 500; i++) {
        const an = -i * (i - s);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        c = b + an / c;
        if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        const delta = d * c;
        h *= delta;
        if (Math.abs(delta - 1) < 1e-14) break;
    }
    return Math.exp(-x + s * Math.log(x) - lnGammaS) * h;
}

function lnGamma(z: number): number {
    // Lanczos approximation, g = 7.
    const g = 7;
    const coef = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
        1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = coef[0]!;
    for (let i = 1; i < g + 2; i++) x += coef[i]! / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export interface SrmResult {
    observed: number[];
    expected: number[];
    chiSquare: number;
    pValue: number;
    /** True when p < threshold: assignment or logging is broken and the comparison should not be trusted. */
    mismatch: boolean;
}

/** Sample ratio mismatch: chi-square goodness of fit of arm sizes against the planned split. */
export function sampleRatioMismatch(observed: readonly number[], plannedShares: readonly number[], threshold = 0.001): SrmResult {
    const total = observed.reduce((s, x) => s + x, 0);
    const shareSum = plannedShares.reduce((s, x) => s + x, 0);
    const expected = plannedShares.map((share) => (total * share) / shareSum);
    const chiSquare = observed.reduce((s, o, i) => s + (o - expected[i]!) ** 2 / expected[i]!, 0);
    const pValue = chiSquarePValue(chiSquare, observed.length - 1);
    return { observed: [...observed], expected, chiSquare, pValue, mismatch: pValue < threshold };
}

/** Cohen's h for two proportions: 2·asin(√p2) − 2·asin(√p1). |h| ≈ 0.2 small, 0.5 medium, 0.8 large. */
export function cohensH(p1: number, p2: number): number {
    return 2 * Math.asin(Math.sqrt(p2)) - 2 * Math.asin(Math.sqrt(p1));
}

/** Newcombe (hybrid Wilson) interval for p2 − p1 between independent samples. */
export function proportionDifference(s1: number, n1: number, s2: number, n2: number, z = 1.96): Interval {
    const a = wilson(s1, n1, z);
    const b = wilson(s2, n2, z);
    const d = b.estimate - a.estimate;
    return {
        estimate: d,
        low: d - Math.sqrt((b.estimate - b.low) ** 2 + (a.high - a.estimate) ** 2),
        high: d + Math.sqrt((b.high - b.estimate) ** 2 + (a.estimate - a.low) ** 2),
    };
}

export interface Confusion {
    labels: string[];
    /** matrix[i][j] = items rater A put in labels[i] and rater B put in labels[j]. */
    matrix: number[][];
}

export function confusion(a: readonly string[], b: readonly string[], labels?: readonly string[]): Confusion {
    if (a.length !== b.length) throw new Error("Raters must label the same items.");
    const all = labels ? [...labels] : [...new Set([...a, ...b])].sort();
    const index = new Map(all.map((label, i) => [label, i]));
    const matrix = all.map(() => all.map(() => 0));
    a.forEach((label, k) => {
        matrix[index.get(label)!]![index.get(b[k]!)!]! += 1;
    });
    return { labels: all, matrix };
}

/** Cohen's kappa: agreement between two raters beyond what their label rates give by chance. */
export function cohensKappa(a: readonly string[], b: readonly string[], labels?: readonly string[]): number {
    const { matrix } = confusion(a, b, labels);
    const n = a.length;
    if (n === 0) return NaN;
    const observed = matrix.reduce((s, row, i) => s + row[i]!, 0) / n;
    const expected = matrix.reduce((s, row, i) => {
        const rowTotal = row.reduce((x, y) => x + y, 0);
        const colTotal = matrix.reduce((x, r) => x + r[i]!, 0);
        return s + (rowTotal / n) * (colTotal / n);
    }, 0);
    return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}
