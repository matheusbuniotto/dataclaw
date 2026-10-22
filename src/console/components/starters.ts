/**
 * Shared starter prompts for DataClaw console
 *
 * Used across Overview and Agents views to launch interactive analytical workflows.
 */

export interface StarterPrompt {
    title: string;
    desc: string;
    query: string;
}

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
    {
        title: "Databricks Catalog Intake",
        desc: "List schemas, pick sample customer table, and run automated profile.",
        query: "Explore the Databricks workspace: list catalogs, pick a table, and profile it.",
    },
    {
        title: "Churn Drivers Analysis",
        desc: "Scan sample-data/customer_churn.csv and identify top retention risk factors.",
        query: "Profile sample-data/customer_churn.csv and tell me what is worth testing.",
    },
    {
        title: "Spawn Specialist Agent",
        desc: "Create a persistent researcher named churn-analyst with isolated workspace.",
        query: "Create a researcher named churn-analyst and have them profile sample-data/customer_churn.csv.",
    },
    {
        title: "Executive Synthesis",
        desc: "Distill the current playbook, plan, and findings into an executive update.",
        query: "Summarize the current plan, findings, and playbook.",
    },
] as const;

export const STARTER_QUERIES: readonly string[] = STARTER_PROMPTS.map((s) => s.query);
