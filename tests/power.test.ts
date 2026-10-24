import { describe, expect, test } from "bun:test";
import {
    calculateClusteredSampleSize,
    calculateMde,
    estimateIcc,
    evaluateShippingDecision,
    normalQuantile,
} from "../evals/power";
import type { EpisodeResult } from "../evals/run";

describe("power analysis", () => {
    test("normalQuantile matches critical z values", () => {
        expect(normalQuantile(0.5)).toBe(0);
        expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
        expect(normalQuantile(0.95)).toBeCloseTo(1.645, 2);
        expect(normalQuantile(0.80)).toBeCloseTo(0.842, 2);
    });

    test("calculateClusteredSampleSize applies design effect correctly", () => {
        // Without clustering (m = 1 or icc = 0), designEffect = 1
        const unclustered = calculateClusteredSampleSize({
            baselineRate: 0.8,
            targetMde: 0.05,
            icc: 0,
            repeatsPerTask: 1,
        });
        expect(unclustered.designEffect).toBe(1);
        expect(unclustered.tasksNeeded).toBe(unclustered.effectiveSampleSizeNeeded);

        // With 5 repeats and icc 0.15, design effect = 1 + 4*0.15 = 1.6
        const clustered = calculateClusteredSampleSize({
            baselineRate: 0.8,
            targetMde: 0.05,
            icc: 0.15,
            repeatsPerTask: 5,
        });
        expect(clustered.designEffect).toBeCloseTo(1.6, 2);
        expect(clustered.totalEpisodesNeeded).toBeGreaterThan(unclustered.effectiveSampleSizeNeeded);
    });

    test("calculateMde shrinks with larger sample size", () => {
        const smallMde = calculateMde(10, 3, 0.8, 0.1);
        const largeMde = calculateMde(100, 3, 0.8, 0.1);
        expect(largeMde).toBeLessThan(smallMde);
    });

    test("estimateIcc calculates correlation across tasks", () => {
        const makeEp = (taskId: string, repeat: number, success: boolean): EpisodeResult => ({
            taskId,
            repeat,
            variant: "a",
            model: "m",
            mode: "scripted",
            expected: "1",
            success,
            stuck: { stuck: false, reasons: [], maxRepeats: 1, longestErrorStreak: 0, shippedRejectedFinding: false },
            toolCalls: 1,
            toolErrors: 0,
            tools: ["query"],
            findings: [],
            tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
            costUsd: 0.01,
            costSource: "nominal",
            latencyMs: 100,
        });

        const episodes: EpisodeResult[] = [
            // Task 1: always passes
            makeEp("t1", 0, true),
            makeEp("t1", 1, true),
            // Task 2: always fails
            makeEp("t2", 0, false),
            makeEp("t2", 1, false),
        ];
        const icc = estimateIcc(episodes);
        expect(icc).toBeGreaterThan(0.5); // High intra-cluster agreement
    });

    test("evaluateShippingDecision blocks regressions", () => {
        const decision = evaluateShippingDecision(-0.15, -0.25, -0.05, 0.002, 20, 5);
        expect(decision.verdict).toBe("REGRESSION_BLOCKED");
    });

    test("evaluateShippingDecision flags underpowered tests", () => {
        // Small difference +0.02, p = 0.40, with only 9 tasks (MDE is ~0.30)
        const decision = evaluateShippingDecision(0.02, -0.10, 0.14, 0.40, 9, 5, { targetMde: 0.05 });
        expect(decision.verdict).toBe("UNDERPOWERED");
    });

    test("evaluateShippingDecision approves well-powered winners", () => {
        // Clear uplift +0.12, 95% CI strictly positive [0.06, 0.18], p = 0.001
        const decision = evaluateShippingDecision(0.12, 0.06, 0.18, 0.001, 100, 5, { targetMde: 0.05 });
        expect(decision.verdict).toBe("SHIPPABLE");
    });
});
