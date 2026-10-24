import { describe, expect, test } from "bun:test";
import {
    compareGrowthFunnels,
    identifyGrowthOpportunities,
    simulateFunnelFromEpisodes,
} from "../evals/growth-funnel";
import type { EpisodeResult } from "../evals/run";

describe("growth funnel engine", () => {
    const makeEp = (overrides: Partial<EpisodeResult> = {}): EpisodeResult => ({
        variant: "test",
        taskId: "t1",
        repeat: 0,
        model: "m",
        mode: "scripted",
        expected: "1",
        success: true,
        stuck: { stuck: false, reasons: [], maxRepeats: 1, longestErrorStreak: 0, shippedRejectedFinding: false },
        toolCalls: 5,
        toolErrors: 0,
        tools: ["query"],
        findings: [],
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
        costUsd: 0.01,
        costSource: "nominal",
        latencyMs: 100,
        ...overrides,
    });

    test("simulateFunnelFromEpisodes computes 5 stages cleanly", () => {
        const episodes = [makeEp(), makeEp(), makeEp()];
        const result = simulateFunnelFromEpisodes(episodes, "clean-variant", 10_000);

        expect(result.stages.length).toBe(5);
        expect(result.stages[0]!.users).toBe(10_000);
        expect(result.stuckRate).toBe(0);
        expect(result.activationRate).toBeGreaterThan(0.6);
        expect(result.retention30dRate).toBeGreaterThan(0.3);
        expect(result.costPerSuccessfulOutcome).toBeGreaterThan(0);
    });

    test("agent stuck rates degrade activation and retention", () => {
        const cleanEpisodes = [makeEp(), makeEp()];
        const stuckEpisodes = [
            makeEp({ stuck: { stuck: true, reasons: ["repeated_call"], maxRepeats: 3, longestErrorStreak: 0, shippedRejectedFinding: false } }),
            makeEp({ stuck: { stuck: true, reasons: ["error_streak"], maxRepeats: 1, longestErrorStreak: 3, shippedRejectedFinding: true } }),
        ];

        const cleanResult = simulateFunnelFromEpisodes(cleanEpisodes, "clean", 10_000);
        const stuckResult = simulateFunnelFromEpisodes(stuckEpisodes, "stuck", 10_000);

        expect(stuckResult.activationRate).toBeLessThan(cleanResult.activationRate);
        expect(stuckResult.retention30dRate).toBeLessThan(cleanResult.retention30dRate);
        expect(stuckResult.costPerSuccessfulOutcome).toBeGreaterThan(cleanResult.costPerSuccessfulOutcome);
    });

    test("compareGrowthFunnels calculates bootstrap intervals and ARR delta", () => {
        const episodesA = [
            makeEp({ taskId: "t1", stuck: { stuck: true, reasons: ["repeated_call"], maxRepeats: 3, longestErrorStreak: 0, shippedRejectedFinding: false } }),
            makeEp({ taskId: "t2", stuck: { stuck: false, reasons: [], maxRepeats: 1, longestErrorStreak: 0, shippedRejectedFinding: false } }),
        ];
        const episodesB = [
            makeEp({ taskId: "t1", stuck: { stuck: false, reasons: [], maxRepeats: 1, longestErrorStreak: 0, shippedRejectedFinding: false } }),
            makeEp({ taskId: "t2", stuck: { stuck: false, reasons: [], maxRepeats: 1, longestErrorStreak: 0, shippedRejectedFinding: false } }),
        ];

        const comp = compareGrowthFunnels(episodesA, episodesB, 5000);
        expect(comp.activationUpliftPp).toBeGreaterThan(0);
        expect(comp.annualArrDelta).toBeGreaterThan(0);
    });

    test("identifyGrowthOpportunities flags critical stuck loops", () => {
        const stuckRuns = [
            makeEp({ stuck: { stuck: true, reasons: ["repeated_call"], maxRepeats: 3, longestErrorStreak: 0, shippedRejectedFinding: true } }),
            makeEp({ stuck: { stuck: true, reasons: ["repeated_call"], maxRepeats: 3, longestErrorStreak: 0, shippedRejectedFinding: false } }),
        ];
        const opps = identifyGrowthOpportunities(stuckRuns);
        expect(opps.some((o) => o.id === "opp-stuck-loops")).toBe(true);
        expect(opps.some((o) => o.id === "opp-auditor-gate")).toBe(true);
    });
});
