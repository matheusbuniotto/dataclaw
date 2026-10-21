import { readFileSync } from "node:fs";
import type { EpisodeResult } from "./run";
import { cohensKappa, confusion, rng, quantile } from "./stats";

/**
 * Calibrate the auditor (DataClaw's LLM judge of findings) against human labels.
 *
 *   export: one CSV row per audited finding, without the auditor's verdict, for blind labeling.
 *   score:  join the labeled CSV back to the results and report agreement and Cohen's kappa.
 */

export const VERDICTS = ["confirmed", "caution", "rejected"] as const;
const COLUMNS = ["item_id", "task_id", "expected_answer", "title", "observation", "query", "human_label", "label_source"] as const;

export interface AuditedItem {
    itemId: string;
    taskId: string;
    expected: string;
    title: string;
    observation: string;
    query: string;
    auditorVerdict: string;
}

export function auditedItems(rows: readonly EpisodeResult[]): AuditedItem[] {
    return rows.flatMap((row) =>
        row.findings
            .filter((f) => f.auditVerdict)
            .map((f) => ({
                itemId: `${row.variant}|${row.taskId}|${row.repeat}|${f.id}`,
                taskId: row.taskId,
                expected: String(row.expected),
                title: f.title,
                observation: f.observation,
                query: f.query ?? "",
                auditorVerdict: f.auditVerdict!,
            })),
    );
}

const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function toCsv(items: readonly AuditedItem[]): string {
    const lines = [COLUMNS.join(",")];
    for (const item of items) {
        lines.push([item.itemId, item.taskId, item.expected, item.title, item.observation, item.query, "", ""].map(quote).join(","));
    }
    return lines.join("\n") + "\n";
}

export function parseCsv(text: string): Record<string, string>[] {
    const records: string[][] = [];
    let field = "";
    let record: string[] = [];
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") { record.push(field); field = ""; }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            record.push(field); field = "";
            if (record.some((v) => v !== "")) records.push(record);
            record = [];
        } else field += ch;
    }
    if (field !== "" || record.length > 0) { record.push(field); records.push(record); }
    const [header, ...body] = records;
    if (!header) return [];
    return body.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""])));
}

export interface CalibrationReport {
    items: number;
    exampleLabels: number;
    agreement: number;
    kappa: number;
    kappaLow: number;
    kappaHigh: number;
    labels: string[];
    matrix: number[][];
    unmatched: string[];
}

/** Human label is rater A (rows), auditor is rater B (columns). */
export function score(labels: readonly Record<string, string>[], items: readonly AuditedItem[], seed = 3): CalibrationReport {
    const byId = new Map(items.map((item) => [item.itemId, item]));
    const human: string[] = [];
    const auditor: string[] = [];
    const unmatched: string[] = [];
    let exampleLabels = 0;
    for (const row of labels) {
        const label = row.human_label?.trim().toLowerCase();
        if (!label) continue;
        if (!(VERDICTS as readonly string[]).includes(label)) throw new Error(`Unknown label "${label}" for ${row.item_id}.`);
        const item = byId.get(row.item_id ?? "");
        if (!item) { unmatched.push(row.item_id ?? "?"); continue; }
        if (row.label_source?.trim().toUpperCase() === "EXAMPLE") exampleLabels++;
        human.push(label);
        auditor.push(item.auditorVerdict);
    }
    const { matrix } = confusion(human, auditor, VERDICTS);
    const next = rng(seed);
    const draws: number[] = [];
    for (let i = 0; i < 2000 && human.length > 0; i++) {
        const idx = human.map(() => Math.floor(next() * human.length));
        const k = cohensKappa(idx.map((j) => human[j]!), idx.map((j) => auditor[j]!), VERDICTS);
        if (Number.isFinite(k)) draws.push(k);
    }
    return {
        items: human.length,
        exampleLabels,
        agreement: human.length ? human.filter((h, i) => h === auditor[i]).length / human.length : NaN,
        kappa: cohensKappa(human, auditor, VERDICTS),
        kappaLow: quantile(draws, 0.025),
        kappaHigh: quantile(draws, 0.975),
        labels: [...VERDICTS],
        matrix,
        unmatched,
    };
}

export function renderCalibration(report: CalibrationReport): string {
    const lines: string[] = [];
    if (report.exampleLabels > 0) {
        lines.push(
            `WARNING: ${report.exampleLabels} of ${report.items} labels are marked EXAMPLE. They are placeholders, not human`,
            "judgments, so the agreement below is not a calibration result.",
            "",
        );
    }
    lines.push(
        `Labeled items: ${report.items}`,
        `Raw agreement: ${(report.agreement * 100).toFixed(1)}%`,
        `Cohen's kappa: ${report.kappa.toFixed(2)} [95% bootstrap CI ${report.kappaLow.toFixed(2)}, ${report.kappaHigh.toFixed(2)}]`,
        "",
        `| human \\ auditor | ${report.labels.join(" | ")} |`,
        `| --- | ${report.labels.map(() => "---").join(" | ")} |`,
        ...report.matrix.map((row, i) => `| ${report.labels[i]} | ${row.join(" | ")} |`),
    );
    if (report.unmatched.length) lines.push("", `Labels with no matching finding: ${report.unmatched.join(", ")}`);
    return lines.join("\n") + "\n";
}

function readResults(paths: readonly string[]): EpisodeResult[] {
    return paths.flatMap((path) => readFileSync(path, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EpisodeResult));
}

if (import.meta.main) {
    const [command, ...args] = process.argv.slice(2);
    if (command === "export" && args.length > 0) {
        process.stdout.write(toCsv(auditedItems(readResults(args))));
    } else if (command === "score" && args.length > 1) {
        const [labelsPath, ...results] = args;
        const report = score(parseCsv(readFileSync(labelsPath!, "utf-8")), auditedItems(readResults(results)));
        process.stdout.write(renderCalibration(report));
    } else {
        console.error("Usage:\n  bun run evals:calibrate export <results.jsonl...> > labels.csv\n  bun run evals:calibrate score <labels.csv> <results.jsonl...>");
        process.exit(1);
    }
}
