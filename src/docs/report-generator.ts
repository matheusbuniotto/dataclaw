/**
 * Executive Report Generator for DataClaw
 *
 * Compiles durable state (Plan, Findings, Playbook, Telemetry) into professional
 * stakeholder memos in Markdown, self-contained HTML, and JSON formats.
 */

import type { AnalystPlanDocument } from "./plan";
import type { FindingsDocument, Finding } from "./findings";
import type { PlaybookDocument } from "./playbook";
import type { TelemetryDocument } from "./telemetry";

export interface ReportInput {
    plan?: Partial<AnalystPlanDocument> | null;
    findings?: Partial<FindingsDocument> | null;
    playbook?: Partial<PlaybookDocument> | null;
    telemetry?: Partial<TelemetryDocument> | null;
    agentName?: string;
    generatedAt?: number;
}

export function generateMarkdownReport(input: ReportInput): string {
    const plan = input.plan;
    const findingsDoc = input.findings;
    const playbook = input.playbook;
    const agentName = input.agentName ?? "DataClaw Durable Analyst";
    const dateStr = new Date(input.generatedAt ?? Date.now()).toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
    });

    const goal = plan?.goal ?? "Ad-hoc Data Investigation";
    const dataset = plan?.activeDataset;
    const sourceInfo = plan?.dataSource
        ? `${plan.dataSource.provider} (dialect: ${plan.dataSource.dialect})`
        : dataset?.provider ?? "Local SQLite";

    const lines: string[] = [
        `# Executive Analytical Memo: ${goal}`,
        `**Author**: ${agentName} | **Generated**: ${dateStr}`,
        `**Status**: ${plan?.status?.toUpperCase() ?? "COMPLETED"} | **Milestone**: ${plan?.currentMilestone ?? "Complete"}`,
        "",
        "---",
        "",
        "## 1. Executive Summary",
        "",
    ];

    if (findingsDoc?.executiveSummary) {
        lines.push(findingsDoc.executiveSummary);
    } else {
        lines.push(
            `This investigation analyzed data source **${dataset?.name ?? "active dataset"}** (${sourceInfo}) ` +
            `to address: *"${goal}"*. ` +
            `A total of ${findingsDoc?.findings?.length ?? 0} analytical findings were synthesized across ${plan?.hypotheses?.length ?? 0} strategic hypotheses.`
        );
    }

    if (findingsDoc?.keyTakeaways && findingsDoc.keyTakeaways.length > 0) {
        lines.push("", "### Key Strategic Takeaways:", "");
        for (const t of findingsDoc.keyTakeaways) {
            lines.push(`- **${t}**`);
        }
    }

    lines.push("", "---", "", "## 2. Dataset & Operational Context", "");
    if (dataset) {
        lines.push(`- **Table / Asset**: \`${dataset.name}\``);
        lines.push(`- **Provider**: ${dataset.provider ?? sourceInfo}`);
        if (dataset.sourcePath) lines.push(`- **Source Path**: \`${dataset.sourcePath}\``);
        lines.push(`- **Dimensions**: ${dataset.rowCount.toLocaleString()} rows × ${dataset.columns.length} columns`);
        lines.push(`- **Columns**: \`${dataset.columns.join("`, `")}\``);
    } else {
        lines.push("- *No active dataset attached to the plan.*");
    }

    if (plan?.hypotheses && plan.hypotheses.length > 0) {
        lines.push("", "---", "", "## 3. Hypotheses & Validation Status", "");
        for (const h of plan.hypotheses) {
            const badge = h.status === "validated" ? "✅ VALIDATED"
                : h.status === "refuted" ? "❌ REFUTED"
                : h.status === "testing" ? "⏳ IN PROGRESS"
                : "💡 PROPOSED";
            lines.push(`### [${h.id}] ${h.title}`);
            lines.push(`- **Status**: ${badge}`);
            lines.push(`- **Description**: ${h.description}`);
            if (h.notes) lines.push(`- **Notes**: ${h.notes}`);
            lines.push("");
        }
    }

    const findingsList: Finding[] = (findingsDoc?.findings ?? []) as Finding[];
    lines.push("---", "", `## 4. Audited Findings & Evidence (${findingsList.length})`, "");

    if (findingsList.length === 0) {
        lines.push("- *No findings recorded yet in FindingsDoc.*");
    } else {
        for (const f of findingsList) {
            const auditBadge = f.audited
                ? f.auditVerdict === "confirmed" ? "🟢 CONFIRMED"
                : f.auditVerdict === "caution" ? "🟡 CAUTION"
                : "🔴 REJECTED"
                : "⚪ UNAUDITED";

            lines.push(`### ${f.title}`);
            lines.push(`- **Impact**: **${f.impact.toUpperCase()}** | **Confidence**: ${(f.confidence * 100).toFixed(1)}% | **Audit**: ${auditBadge}`);
            lines.push(`- **Observation**: ${f.observation}`);

            if (f.evidence.query) {
                lines.push("- **Evidence SQL Query**:");
                lines.push("```sql");
                lines.push(f.evidence.query.trim());
                lines.push("```");
            }

            if (f.evidence.rationale) {
                lines.push(`- **Rationale**: ${f.evidence.rationale}`);
            }

            if (f.auditNotes) {
                lines.push(`- **Auditor Notes**: *${f.auditNotes}*`);
            }

            if (f.actionableRecommendations && f.actionableRecommendations.length > 0) {
                lines.push("- **Actionable Recommendations**:");
                for (const r of f.actionableRecommendations) {
                    lines.push(`  - [ ] ${r}`);
                }
            }
            lines.push("");
        }
    }

    if (playbook?.heuristics && playbook.heuristics.length > 0) {
        lines.push("---", "", `## 5. Active Institutional Playbook (v${playbook.version ?? 1})`, "");
        lines.push("DataClaw applies institutional heuristics learned across sessions to avoid repetitive analytical pitfalls:");
        lines.push("");
        for (const h of playbook.heuristics) {
            lines.push(`- **[${h.domain}]** (${h.source}, conf=${(h.confidence * 100).toFixed(0)}%): ${h.rule}`);
        }
    }

    return lines.join("\n");
}

export function generateHtmlReport(input: ReportInput): string {
    const md = generateMarkdownReport(input);
    const plan = input.plan;
    const findingsDoc = input.findings;
    const goal = plan?.goal ?? "Ad-hoc Data Investigation";
    const dateStr = new Date(input.generatedAt ?? Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });

    const findingsList: Finding[] = (findingsDoc?.findings ?? []) as Finding[];

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Executive Briefing: ${escapeHtml(goal)}</title>
    <style>
        :root {
            --bg: #0c0f12;
            --surface: #151920;
            --surface-card: #1c222c;
            --border: #283140;
            --text-primary: #e6edf3;
            --text-secondary: #9aa8b8;
            --text-muted: #647385;
            --accent: #2dd4bf;
            --accent-glow: rgba(45, 212, 191, 0.15);
            --danger: #f43f5e;
            --warning: #f59e0b;
            --success: #10b981;
            --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        @media (prefers-color-scheme: light) {
            :root {
                --bg: #f8fafc;
                --surface: #ffffff;
                --surface-card: #f1f5f9;
                --border: #e2e8f0;
                --text-primary: #0f172a;
                --text-secondary: #475569;
                --text-muted: #94a3b8;
                --accent: #0d9488;
                --accent-glow: rgba(13, 148, 136, 0.1);
            }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg);
            color: var(--text-primary);
            font-family: var(--sans);
            line-height: 1.6;
            padding: 40px 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 48px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        }
        .memo-header {
            border-bottom: 2px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 32px;
        }
        .memo-eyebrow {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--accent);
            margin-bottom: 8px;
        }
        h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px; }
        .meta-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            font-size: 13px;
            color: var(--text-secondary);
        }
        .badge {
            display: inline-flex;
            align-items: center;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .badge-success { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
        .badge-warning { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
        .badge-danger { background: rgba(244, 63, 94, 0.15); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.3); }
        .badge-info { background: var(--accent-glow); color: var(--accent); border: 1px solid var(--accent); }
        h2 {
            font-size: 20px;
            font-weight: 700;
            margin: 36px 0 16px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
            color: var(--text-primary);
        }
        p { margin-bottom: 16px; color: var(--text-secondary); font-size: 15px; }
        .takeaway-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 24px;
        }
        .takeaway-item {
            background: var(--surface-card);
            border-left: 4px solid var(--accent);
            border-radius: 6px;
            padding: 12px 16px;
            font-size: 14px;
            color: var(--text-primary);
        }
        .card {
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .card-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        pre, code {
            font-family: var(--mono);
            font-size: 13px;
        }
        code {
            background: rgba(125,125,125,0.12);
            padding: 2px 6px;
            border-radius: 4px;
        }
        pre {
            background: #090c10;
            color: #7dd3fc;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 12px 0;
            border: 1px solid #1e2432;
        }
        details summary {
            cursor: pointer;
            font-size: 13px;
            color: var(--accent);
            font-weight: 600;
            margin-top: 10px;
        }
        ul.recs {
            margin: 12px 0 0 20px;
            color: var(--text-secondary);
            font-size: 14px;
        }
        .footer {
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px solid var(--border);
            font-size: 12px;
            color: var(--text-muted);
            display: flex;
            justify-content: space-between;
        }
        @media print {
            body { padding: 0; background: #fff; color: #000; }
            .container { box-shadow: none; border: none; padding: 0; }
            pre { background: #f4f4f4; color: #000; border: 1px solid #ccc; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="memo-header">
            <div class="memo-eyebrow">DataClaw Executive Intelligence Briefing</div>
            <h1>${escapeHtml(goal)}</h1>
            <div class="meta-bar">
                <span>Date: <strong>${dateStr}</strong></span>
                <span>Dataset: <strong>${escapeHtml(plan?.activeDataset?.name ?? "Active Table")}</strong></span>
                <span class="badge badge-info">${escapeHtml(plan?.status ?? "Completed")}</span>
            </div>
        </div>

        <h2>Executive Summary</h2>
        <p>${escapeHtml(findingsDoc?.executiveSummary ?? "Analysis completed with validated statistical evidence.")}</p>

        ${findingsDoc?.keyTakeaways && findingsDoc.keyTakeaways.length > 0 ? `
            <ul class="takeaway-list">
                ${findingsDoc.keyTakeaways.map(t => `<li class="takeaway-item"><strong>${escapeHtml(t)}</strong></li>`).join("")}
            </ul>
        ` : ""}

        <h2>Verified Analytical Findings (${findingsList.length})</h2>
        ${findingsList.map(f => {
            const auditBadgeClass = f.audited
                ? f.auditVerdict === "confirmed" ? "badge-success"
                : f.auditVerdict === "caution" ? "badge-warning"
                : "badge-danger"
                : "badge-info";
            const auditText = f.audited ? `Audit: ${f.auditVerdict?.toUpperCase()}` : "Unaudited";
            return `
            <div class="card">
                <div class="card-header">
                    <div class="card-title">${escapeHtml(f.title)}</div>
                    <span class="badge ${auditBadgeClass}">${auditText}</span>
                </div>
                <p><strong>Impact:</strong> ${f.impact.toUpperCase()} | <strong>Confidence:</strong> ${(f.confidence * 100).toFixed(0)}%</p>
                <p>${escapeHtml(f.observation)}</p>
                ${f.evidence.query ? `
                    <details>
                        <summary>View SQL Evidence & Rationale</summary>
                        <pre><code>${escapeHtml(f.evidence.query)}</code></pre>
                        <p style="font-size: 13px;"><em>Rationale: ${escapeHtml(f.evidence.rationale)}</em></p>
                    </details>
                ` : ""}
                ${f.actionableRecommendations && f.actionableRecommendations.length > 0 ? `
                    <p style="margin-top: 12px; margin-bottom: 4px; font-weight: 600;">Recommended Actions:</p>
                    <ul class="recs">
                        ${f.actionableRecommendations.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
                    </ul>
                ` : ""}
            </div>
            `;
        }).join("")}

        <div class="footer">
            <span>DataClaw AI Agent · Durable Execution on SQLite WAL</span>
            <span>Checkpointed & Resumable</span>
        </div>
    </div>
</body>
</html>`;
}

export function generateJsonReport(input: ReportInput): Record<string, unknown> {
    return {
        agent: input.agentName ?? "DataClaw",
        generatedAt: input.generatedAt ?? Date.now(),
        plan: input.plan ?? null,
        findings: input.findings ?? null,
        playbook: input.playbook ?? null,
        telemetry: input.telemetry ?? null,
    };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
