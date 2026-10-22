import { expect, test, describe } from "bun:test";
import {
    generateMarkdownReport,
    generateHtmlReport,
    generateJsonReport,
    type ReportInput,
} from "../src/docs/report-generator";

describe("Executive Report Generator", () => {
    const mockInput: ReportInput = {
        agentName: "DataClaw Lead Analyst",
        generatedAt: 1700000000000,
        plan: {
            goal: "Diagnose Customer Churn Acceleration",
            status: "completed",
            currentMilestone: "Executive Synthesis",
            activeDataset: {
                name: "b2b_churn",
                provider: "local",
                sourcePath: "sample-data/customer_churn.csv",
                rowCount: 1200,
                columns: ["customer_id", "tier", "support_tickets", "churned"],
            },
            hypotheses: [
                {
                    id: "hyp-1",
                    title: "Support ticket volume correlates with churn",
                    description: "Customers with > 3 tickets in 30 days churn 4x more often",
                    status: "validated",
                    evidenceIds: ["find-1"],
                    proposedAt: 1700000000000,
                    updatedAt: 1700000000000,
                },
            ],
        },
        findings: {
            executiveSummary: "Analysis validates that ticket volume is the primary churn leading indicator.",
            keyTakeaways: [
                "Proactive CSM outreach needed when tickets >= 3",
                "Self-serve onboarding requires renewal prompts",
            ],
            findings: [
                {
                    id: "find-1",
                    hypothesisId: "hyp-1",
                    title: "Support ticket volume is leading churn driver (r = 0.88)",
                    observation: "Pearson correlation between support_tickets and churn is 0.88 across 1200 accounts.",
                    impact: "critical",
                    confidence: 0.95,
                    audited: true,
                    auditVerdict: "confirmed",
                    auditNotes: "Statistically robust. Confounders controlled for.",
                    evidence: {
                        query: "SELECT support_tickets, AVG(churned) FROM b2b_churn GROUP BY support_tickets;",
                        rationale: "Cohort aggregation confirms monotonic increase in churn probability.",
                    },
                    actionableRecommendations: [
                        "Deploy automated PagerDuty alert to customer success team",
                    ],
                    discoveredAt: 1700000000000,
                },
            ],
        },
        playbook: {
            version: 2,
            heuristics: [
                {
                    id: "rule-1",
                    domain: "data_hygiene",
                    rule: "Always check minimum sample size n >= 30 before asserting cohort churn differences.",
                    source: "seed",
                    confidence: 0.95,
                    timesApplied: 5,
                    createdTimestamp: 1700000000000,
                },
            ],
            queryTemplates: [],
            antiPatterns: [],
            improvementLog: [],
            lastImprovedAt: 1700000000000,
        },
    };

    test("generates markdown executive briefing with findings, evidence, and audit verdict", () => {
        const md = generateMarkdownReport(mockInput);
        expect(md).toContain("# Executive Analytical Memo: Diagnose Customer Churn Acceleration");
        expect(md).toContain("DataClaw Lead Analyst");
        expect(md).toContain("🟢 CONFIRMED");
        expect(md).toContain("Support ticket volume is leading churn driver");
        expect(md).toContain("SELECT support_tickets, AVG(churned)");
        expect(md).toContain("Deploy automated PagerDuty alert");
        expect(md).toContain("data_hygiene");
    });

    test("generates self-contained HTML report with modern executive styling", () => {
        const html = generateHtmlReport(mockInput);
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("Executive Briefing: Diagnose Customer Churn Acceleration");
        expect(html).toContain("badge-success");
        expect(html).toContain("Audit: CONFIRMED");
        expect(html).toContain("SELECT support_tickets, AVG(churned)");
    });

    test("generates JSON report payload for downstream ingestion", () => {
        const json = generateJsonReport(mockInput);
        expect(json.agent).toBe("DataClaw Lead Analyst");
        expect(json.plan).toBeDefined();
        expect(json.findings).toBeDefined();
    });
});
