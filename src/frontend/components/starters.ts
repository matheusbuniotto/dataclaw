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
        title: "Explore Unity Catalog & Profile Table",
        desc: "Discover catalogs, inspect schemas, and compute statistical profiles across Delta tables.",
        query: "Explore the Databricks workspace: list catalogs and schemas, pick a sample customer table, and profile it.",
        category: "data",
    },
    {
        title: "Consult Databricks AI/BI Genie",
        desc: "Ask a curated Genie space for certified business definitions and validated gold SQL.",
        query: "List available Databricks Genie spaces with databricks_genie_list, then consult the primary space on customer retention and revenue KPIs.",
        category: "data",
    },
    {
        title: "Unity Catalog system.ai Enrichment",
        desc: "Leverage ai_summarize, ai_classify, or ai_query directly within Delta Lake queries.",
        query: "Test Databricks native system.ai functions: classify and summarize customer feedback using databricks_ai_function.",
        category: "data",
    },
    {
        title: "Skeptical Auditor Peer Review",
        desc: "Audit findings for p-hacking, Simpson's Paradox, and small-sample false positives.",
        query: "Review the latest findings using request_auditor_review and verify statistical validity before committing to the playbook.",
        category: "audit",
    },
    {
        title: "Log Benchmark Evals to MLflow",
        desc: "Record agent evaluation scores and statistical power metrics to Databricks MLflow.",
        query: "Evaluate current analysis metrics and log benchmark eval scores to the workspace MLflow tracking server at /Shared/dataclaw-evals.",
        category: "audit",
    },
    {
        title: "Statistical Power & Shipping Gate",
        desc: "Evaluate ICC = 0.150, VIF = 1.60x, and verify if the experiment is sufficiently powered to ship.",
        query: "Calculate the intra-cluster correlation (ICC) and design effect for repeated task runs, then check if we meet the MDE = 5pp shipping gate.",
        category: "growth",
    },
    {
        title: "Executive Intelligence Briefing",
        desc: "Distill the current playbook, plan, and audited evidence into a stakeholder briefing.",
        query: "Summarize the current plan, findings, and playbook into an executive decision update with clear next steps and SQL audit trails.",
        category: "agent",
    },
] as const;

export const STARTER_QUERIES: readonly string[] = STARTER_PROMPTS.map((s) => s.query);
