/**
 * Shared starter prompts for DataClaw console
 *
 * Used across Overview and Agents views to launch interactive analytical workflows.
 */

export interface StarterPrompt {
    title: string;
    desc: string;
    query: string;
    category?: "data" | "audit" | "growth" | "agent";
}

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
    {
        title: "Explore Databricks & Profile Catalog",
        desc: "List Unity Catalog schemas in samples, inspect tables, and profile distributions.",
        query: "Explore the Databricks workspace: list catalogs, pick a sample customer table, and profile it.",
        category: "data",
    },
    {
        title: "Analyze Churn Drivers & Form Hypotheses",
        desc: "Profile customer_churn.csv, run read-only queries, and identify retention risk factors.",
        query: "Load and profile sample-data/customer_churn.csv. Formulate 2 testable hypotheses on churn drivers with supporting SQL queries.",
        category: "growth",
    },
    {
        title: "Skeptical Auditor Peer Review",
        desc: "Audit findings for p-hacking, Simpson's Paradox, and small-sample false positives.",
        query: "Review the latest findings using request_auditor_review and verify statistical validity before committing to the playbook.",
        category: "audit",
    },
    {
        title: "Statistical Power & Shipping Decision Gate",
        desc: "Evaluate ICC = 0.150, VIF = 1.60x, and verify if the experiment is sufficiently powered to ship.",
        query: "Calculate the intra-cluster correlation (ICC) and design effect for repeated task runs, then check if we meet the MDE = 5pp shipping gate.",
        category: "growth",
    },
    {
        title: "Executive Synthesis & Intelligence Briefing",
        desc: "Distill the current playbook, plan, and audited evidence into an executive briefing.",
        query: "Summarize the current plan, findings, and playbook into an executive decision update with clear next steps.",
        category: "agent",
    },
] as const;

export const STARTER_QUERIES: readonly string[] = STARTER_PROMPTS.map((s) => s.query);
