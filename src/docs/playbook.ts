import { defineDoc } from "@earendil-works/pi-durable";

export interface PlaybookHeuristic {
    id: string;
    domain: string;
    rule: string;
    source: "seed" | "reflection" | "human_feedback" | "audit_discovery";
    confidence: number;
    timesApplied: number;
    createdTimestamp: number;
}

export interface QueryPatternTemplate {
    name: string;
    description: string;
    sqlTemplate: string;
    domain: string;
}

export interface AntiPatternRule {
    id: string;
    name: string;
    pattern: string;
    mitigation: string;
    discoveredFromError?: string;
}

export interface PlaybookDocument {
    version: number;
    heuristics: PlaybookHeuristic[];
    queryTemplates: QueryPatternTemplate[];
    antiPatterns: AntiPatternRule[];
    improvementLog: Array<{
        timestamp: number;
        reason: string;
        addedHeuristicIds: string[];
        notes: string;
    }>;
    lastImprovedAt: number;
}

export const PlaybookDoc = defineDoc<PlaybookDocument>({
    kind: "analyst.playbook",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({
        version: 1,
        heuristics: [
            {
                id: "rule-seed-1",
                domain: "data_hygiene",
                rule: "Always verify null counts, sample size, and zero-values before asserting correlation or trend ratios.",
                source: "seed",
                confidence: 0.95,
                timesApplied: 0,
                createdTimestamp: Date.now(),
            },
            {
                id: "rule-seed-2",
                domain: "business_metrics",
                rule: "Segment retention/churn by tenure bracket (e.g., <=3 months vs >12 months); new accounts skew churn 3-5x higher.",
                source: "seed",
                confidence: 0.9,
                timesApplied: 0,
                createdTimestamp: Date.now(),
            },
            {
                id: "rule-seed-3",
                domain: "sql_safety",
                rule: "Use COALESCE on denominator divisions (e.g., NULLIF(count, 0)) to avoid database divide-by-zero exceptions.",
                source: "seed",
                confidence: 1.0,
                timesApplied: 0,
                createdTimestamp: Date.now(),
            },
        ],
        queryTemplates: [
            {
                name: "cohort_churn_by_tier",
                description: "Calculates churn rate, average monthly spend, and ticket counts grouped by tier and contract type",
                domain: "retention",
                sqlTemplate: "SELECT plan_tier, contract_type, COUNT(*) AS total_accounts, ROUND(AVG(churned) * 100, 2) AS churn_rate_pct, ROUND(AVG(monthly_spend), 2) AS avg_spend, ROUND(AVG(support_tickets_30d), 2) AS avg_tickets FROM data GROUP BY plan_tier, contract_type ORDER BY churn_rate_pct DESC;",
            },
        ],
        antiPatterns: [
            {
                id: "anti-simpsons-paradox",
                name: "Aggregated Simpson's Paradox",
                pattern: "Asserting a causal trend across the aggregate population without checking sub-cohorts (e.g., plan tier or contract duration).",
                mitigation: "Always group by primary stratifying dimension and calculate cross-tabulated breakdowns.",
            },
        ],
        improvementLog: [],
        lastImprovedAt: Date.now(),
    }),
});
