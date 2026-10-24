import { calculateClusteredSampleSize, calculateMde, evaluateShippingDecision } from "../../../evals/power";
import { compareGrowthFunnels, identifyGrowthOpportunities } from "../../../evals/growth-funnel";
import { cohensKappa, confusion } from "../../../evals/stats";
import { defaultLangWatchTracer } from "../../observability/langwatch";
import type { EpisodeResult } from "../../../evals/run";

export interface ObservabilitySummary {
    evals: {
        episodesCount: number;
        tasksCount: number;
        baselineSuccessRate: number;
        candidateSuccessRate: number;
        baselineStuckRate: number;
        candidateStuckRate: number;
        stuckReductionPp: number;
        cohensH: number;
        srmPValue: number;
    };
    power: {
        icc: number;
        designEffect: number;
        currentMdePp: number;
        tasksNeededFor5pp: number;
        shippingVerdict: string;
        shippingExplanation: string;
    };
    growth: {
        cohortSize: number;
        activationUpliftPp: number;
        retentionUpliftPp: number;
        costReductionPct: number;
        projectedArrDelta: string;
        stages: Array<{ stage: string; controlUsers: number; treatmentUsers: number; conversionRate: number }>;
        topOpportunity: { title: string; impact: string; estimatedArr: string; experiment: string };
    };
    auditor: {
        cohensKappa: number;
        agreementLevel: string;
        confusionMatrix: number[][];
    };
    langwatch: {
        configured: boolean;
        endpoint: string;
        bufferedCount: number;
        recentTraces: Array<{
            trace_id: string;
            goal?: string;
            agent_id?: string;
            spansCount: number;
            spanTypes: string[];
            totalTokens: number;
            durationMs: number;
            stuck?: boolean;
            timestamp: string;
        }>;
    };
}

export function recordSampleTrace(): { ok: boolean; trace_id: string; status: number | "buffered" } {
    const traceId = `tr-demo-${Date.now().toString(36)}`;
    const now = Date.now();
    const trace = {
        trace_id: traceId,
        metadata: {
            service_name: "dataclaw-analyst",
            environment: "development",
            agent_id: "dataclaw",
            goal: "Analyze Unity Catalog sample tables and evaluate statistical power",
            stuck: false,
        },
        spans: [
            {
                span_id: `span-root-${traceId}`,
                type: "chain" as const,
                name: "autonomous_analyst_turn",
                input: { goal: "Analyze Unity Catalog sample tables and evaluate statistical power" },
                output: { findings_count: 2, auditor_verdict: "confirmed" },
                timestamps: { started_at: now - 320, completed_at: now },
                metrics: { prompt_tokens: 1240, completion_tokens: 380, cost: 0.015, duration_ms: 320 },
            },
            {
                span_id: `span-tool-${traceId}`,
                parent_id: `span-root-${traceId}`,
                type: "tool" as const,
                name: "databricks_query",
                input: { statement: "SELECT date, users, churn_pct FROM unity.samples.growth_metrics LIMIT 100" },
                output: { rows_returned: 100, read_only: true },
                timestamps: { started_at: now - 280, completed_at: now - 110 },
                metrics: { duration_ms: 170 },
            },
            {
                span_id: `span-eval-${traceId}`,
                parent_id: `span-root-${traceId}`,
                type: "eval" as const,
                name: "skeptical_auditor_check",
                input: { finding: "User churn down 3.2 pp with p < 0.01", sample_size: 1000 },
                output: { verdict: "confirmed", kappa_score: 0.88, p_hacking_risk: "low" },
                timestamps: { started_at: now - 100, completed_at: now },
                metrics: { duration_ms: 100 },
            },
        ],
    };

    void defaultLangWatchTracer.sendTrace(trace);
    return { ok: true, trace_id: traceId, status: defaultLangWatchTracer.isConfigured ? 200 : "buffered" };
}

export function getObservabilitySummary(): ObservabilitySummary {
    // Standard golden dataset benchmark stats
    const tasksCount = 9;
    const repeatsPerTask = 5;
    const episodesCount = tasksCount * repeatsPerTask * 2;

    const baselineSuccess = 0.844;
    const candidateSuccess = 0.911;
    const baselineStuck = 0.267;
    const candidateStuck = 0.022;

    // Power analysis
    const icc = 0.15;
    const power5pp = calculateClusteredSampleSize({ baselineRate: baselineSuccess, targetMde: 0.05, icc, repeatsPerTask });
    const currentMde = calculateMde(tasksCount, repeatsPerTask, baselineSuccess, icc);
    const shipping = evaluateShippingDecision(0.067, -0.111, 0.244, 0.42, tasksCount, repeatsPerTask, { targetMde: 0.05 });

    // Growth simulation
    const mockEp = (variant: string, success: boolean, stuck: boolean): EpisodeResult => ({
        variant,
        taskId: "t",
        repeat: 0,
        model: "m",
        mode: "scripted",
        expected: "1",
        success,
        stuck: {
            stuck,
            reasons: stuck ? ["repeated_call"] : [],
            maxRepeats: stuck ? 3 : 1,
            longestErrorStreak: 0,
            shippedRejectedFinding: false,
        },
        toolCalls: stuck ? 12 : 5,
        toolErrors: 0,
        tools: ["query"],
        findings: [],
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500 },
        costUsd: 0.02,
        costSource: "nominal",
        latencyMs: 120,
    });

    const epsA = [
        ...Array(33).fill(null).map(() => mockEp("baseline", true, false)),
        ...Array(5).fill(null).map(() => mockEp("baseline", true, true)),
        ...Array(7).fill(null).map(() => mockEp("baseline", false, true)),
    ];
    const epsB = [
        ...Array(41).fill(null).map(() => mockEp("candidate", true, false)),
        ...Array(1).fill(null).map(() => mockEp("candidate", true, true)),
        ...Array(3).fill(null).map(() => mockEp("candidate", false, false)),
    ];

    const growthComp = compareGrowthFunnels(epsA, epsB, 10_000);
    const opps = identifyGrowthOpportunities(epsA);

    // Auditor calibration
    const humanLabels = ["confirmed", "confirmed", "caution", "caution", "rejected", "rejected", "confirmed", "caution", "rejected", "rejected"];
    const auditorLabels = ["confirmed", "caution", "caution", "caution", "rejected", "rejected", "confirmed", "caution", "rejected", "confirmed"];
    const kappa = cohensKappa(humanLabels, auditorLabels);
    const conf = confusion(humanLabels, auditorLabels, ["confirmed", "caution", "rejected"]);

    return {
        evals: {
            episodesCount,
            tasksCount,
            baselineSuccessRate: baselineSuccess,
            candidateSuccessRate: candidateSuccess,
            baselineStuckRate: baselineStuck,
            candidateStuckRate: candidateStuck,
            stuckReductionPp: (baselineStuck - candidateStuck) * 100,
            cohensH: 0.21,
            srmPValue: 1.0,
        },
        power: {
            icc,
            designEffect: 1 + (repeatsPerTask - 1) * icc,
            currentMdePp: currentMde * 100,
            tasksNeededFor5pp: power5pp.tasksNeeded,
            shippingVerdict: shipping.verdict,
            shippingExplanation: shipping.headline,
        },
        growth: {
            cohortSize: 10_000,
            activationUpliftPp: growthComp.activationUpliftPp,
            retentionUpliftPp: growthComp.retentionUpliftPp,
            costReductionPct: growthComp.costReductionPct,
            projectedArrDelta: `+$${(growthComp.annualArrDelta / 1000).toFixed(0)}k ARR`,
            stages: growthComp.candidate.stages.map((s, i) => ({
                stage: s.stage,
                controlUsers: growthComp.baseline.stages[i]?.users ?? 0,
                treatmentUsers: s.users,
                conversionRate: s.conversionRate,
            })),
            topOpportunity: {
                title: opps[0]?.title ?? "Autonomous Stuck-Loop Breaker",
                impact: opps[0]?.impact ?? "CRITICAL",
                estimatedArr: opps[0]?.estimatedArrUplift ?? "+$180k ARR",
                experiment: opps[0]?.proposedExperiment ?? "Deploy heuristic stuck-detector rollback",
            },
        },
        auditor: {
            cohensKappa: kappa,
            agreementLevel: "Substantial agreement (κ = " + kappa.toFixed(3) + ")",
            confusionMatrix: conf.matrix,
        },
        langwatch: {
            configured: defaultLangWatchTracer.isConfigured,
            endpoint: process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
            bufferedCount: defaultLangWatchTracer.bufferedCount,
            recentTraces: defaultLangWatchTracer.getBufferedTraces().slice(-5).map((tr) => {
                const totalTokens = tr.spans.reduce(
                    (acc, sp) => acc + (sp.metrics?.prompt_tokens ?? 0) + (sp.metrics?.completion_tokens ?? 0),
                    0,
                );
                const durationMs = tr.spans.reduce((max, sp) => Math.max(max, sp.metrics?.duration_ms ?? 0), 0);
                const firstSpanTime = tr.spans[0]?.timestamps.started_at;
                return {
                    trace_id: tr.trace_id,
                    goal: tr.metadata.goal,
                    agent_id: tr.metadata.agent_id,
                    spansCount: tr.spans.length,
                    spanTypes: Array.from(new Set(tr.spans.map((sp) => sp.type))),
                    totalTokens,
                    durationMs,
                    stuck: tr.metadata.stuck,
                    timestamp: firstSpanTime ? new Date(firstSpanTime).toLocaleTimeString() : "just now",
                };
            }),
        },
    };
}
