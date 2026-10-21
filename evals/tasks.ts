import { readFileSync } from "node:fs";
import { SqliteDataAdapter } from "../src/adapters/sqlite-adapter";

/**
 * Offline eval tasks. Each has one checkable answer, computed from the dataset by a
 * reference query, so the ground truth never drifts from the data.
 */
export interface EvalTask {
    id: string;
    dataset: string;
    question: string;
    /** Returns one row with an `answer` column. Runs against the dataset loaded as table `data`. */
    referenceSql: string;
    kind: "number" | "text";
    /** Relative tolerance for numbers (default 1%). */
    tolerance?: number;
}

const CHURN = "sample-data/customer_churn.csv";
const INCIDENTS = "sample-data/incident_logs.json";

export const EVAL_TASKS: readonly EvalTask[] = [
    {
        id: "churn-basic-tier",
        dataset: CHURN,
        question: "What share of Basic tier customers churned?",
        referenceSql: "SELECT AVG(churned) AS answer FROM data WHERE plan_tier = 'Basic'",
        kind: "number",
    },
    {
        id: "churn-overall",
        dataset: CHURN,
        question: "What is the overall churn rate across all customers?",
        referenceSql: "SELECT AVG(churned) AS answer FROM data",
        kind: "number",
    },
    {
        id: "churn-payment-failed",
        dataset: CHURN,
        question: "What is the churn rate among customers whose payment failed recently?",
        referenceSql: "SELECT AVG(churned) AS answer FROM data WHERE payment_failed_recently = 1",
        kind: "number",
    },
    {
        id: "churn-monthly-minus-annual",
        dataset: CHURN,
        question: "By how much does the churn rate of Monthly contracts exceed that of Annual contracts? Give the difference as a proportion.",
        referenceSql:
            "SELECT AVG(CASE WHEN contract_type = 'Monthly' THEN churned END) - AVG(CASE WHEN contract_type = 'Annual' THEN churned END) AS answer FROM data",
        kind: "number",
    },
    {
        id: "spend-of-churned",
        dataset: CHURN,
        question: "What is the average monthly spend of customers who churned?",
        referenceSql: "SELECT AVG(monthly_spend) AS answer FROM data WHERE churned = 1",
        kind: "number",
    },
    {
        id: "tickets-churn-correlation",
        dataset: CHURN,
        question: "What is the Pearson correlation between support_tickets_30d and churned?",
        referenceSql:
            "SELECT (COUNT(*) * SUM(support_tickets_30d * churned) - SUM(support_tickets_30d) * SUM(churned)) / " +
            "(SQRT(COUNT(*) * SUM(support_tickets_30d * support_tickets_30d) - SUM(support_tickets_30d) * SUM(support_tickets_30d)) * " +
            "SQRT(COUNT(*) * SUM(churned * churned) - SUM(churned) * SUM(churned))) AS answer FROM data",
        kind: "number",
        tolerance: 0.02,
    },
    {
        id: "incidents-top-service",
        dataset: INCIDENTS,
        question: "Which service had the most incidents?",
        referenceSql: "SELECT service AS answer FROM data GROUP BY service ORDER BY COUNT(*) DESC, service LIMIT 1",
        kind: "text",
    },
    {
        id: "incidents-billing-users",
        dataset: INCIDENTS,
        question: "How many users in total were affected by billing-api incidents?",
        referenceSql: "SELECT SUM(affected_users) AS answer FROM data WHERE service = 'billing-api'",
        kind: "number",
    },
    {
        id: "incidents-longest",
        dataset: INCIDENTS,
        question: "Which incident id lasted the longest?",
        referenceSql: "SELECT id AS answer FROM data ORDER BY duration_min DESC LIMIT 1",
        kind: "text",
    },
];

/** The prompt an agent receives. The ANSWER line makes grading independent of prose style. */
export function taskPrompt(task: EvalTask): string {
    return `${task.question}\nThe data is in ${task.dataset}. End your reply with one line of the form "ANSWER: <value>".`;
}

/** Run the reference query on a fresh adapter. */
export async function expectedAnswer(task: EvalTask): Promise<string | number> {
    const adapter = await SqliteDataAdapter.create(":memory:");
    const content = readFileSync(task.dataset, "utf-8");
    if (task.dataset.endsWith(".json")) await adapter.loadJson("data", content);
    else await adapter.loadCsv("data", content);
    const result = await adapter.query(task.referenceSql);
    const value = result.rows[0]?.answer;
    if (value === undefined || value === null) throw new Error(`Reference query for ${task.id} returned no answer.`);
    return task.kind === "number" ? Number(value) : String(value);
}

/** The text after the last "ANSWER:" marker, or undefined when the reply has none. */
export function answerLine(reply: string): string | undefined {
    const matches = [...reply.matchAll(/ANSWER\s*:\s*(.+)/gi)];
    return matches.length > 0 ? matches[matches.length - 1]![1]!.trim() : undefined;
}

/**
 * Grade a reply. Numbers match within the relative tolerance; a proportion also matches when
 * written as a percentage (0.714 or 71.4%). Text matches case-insensitively as a whole token.
 */
export function grade(task: EvalTask, expected: string | number, reply: string): boolean {
    const answer = answerLine(reply);
    if (answer === undefined) return false;
    if (task.kind === "text") {
        const escaped = String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`, "i").test(answer);
    }
    const target = Number(expected);
    const tolerance = task.tolerance ?? 0.01;
    const close = (x: number) => Math.abs(x - target) <= tolerance * Math.max(Math.abs(target), 1e-9);
    const numbers = [...answer.replace(/,(?=\d{3})/g, "").matchAll(/-?\d+(?:\.\d+)?(%?)/g)];
    return numbers.some(([text, percent]) => {
        const value = Number.parseFloat(text);
        if (percent) return close(value / 100);
        return close(value) || (Math.abs(target) <= 1 && Math.abs(value) > 1 && close(value / 100));
    });
}
