// Page chrome shared by every console page: the page header, a panel, a metric tile, and the
// run row the overview lists.
import type { ReactNode } from "react";
import { Gauge, Workflow } from "lucide-react";
import type { Run, WorkspaceAgent } from "../state/workspace-types";
import { agentById, statusClass } from "./view-model";

export function Header({
    eyebrow,
    title,
    subtitle,
    action,
}: {
    eyebrow: string;
    title: string;
    subtitle: string;
    action?: ReactNode;
}) {
    return (
        <div className="page-head">
            <div>
                <div className="eyebrow">{eyebrow}</div>
                <h1 className="page-title">{title}</h1>
                <p className="page-subtitle">{subtitle}</p>
            </div>
            {action}
        </div>
    );
}

export function Panel({
    title,
    note,
    children,
    action,
}: {
    title: string;
    note?: string;
    children: ReactNode;
    action?: ReactNode;
}) {
    return (
        <section className="panel">
            <div className="panel-head">
                <div>
                    <h2 className="panel-title">{title}</h2>
                    {note && <div className="panel-note">{note}</div>}
                </div>
                {action}
            </div>
            <div className="panel-body">{children}</div>
        </section>
    );
}

export function Metric({
    icon: Icon,
    label,
    value,
    foot,
}: {
    icon: typeof Gauge;
    label: string;
    value: string;
    foot: string;
}) {
    return (
        <div className="metric">
            <div className="metric-top">
                <span>{label}</span>
                <span className="metric-icon">
                    <Icon size={14} />
                </span>
            </div>
            <div className="metric-value">{value}</div>
            <div className="metric-foot" dangerouslySetInnerHTML={{ __html: foot }} />
        </div>
    );
}

export function RunRow({ run, agents, onClick }: { run: Run; agents: WorkspaceAgent[]; onClick: () => void }) {
    const agent = agentById(run.agentId, agents);
    return (
        <div
            className="run-row"
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onClick()}
        >
            <div className="run-main">
                <span className="run-glyph">
                    <Workflow size={15} />
                </span>
                <div style={{ minWidth: 0 }}>
                    <div className="run-name">{run.goal}</div>
                    <div className="run-meta">
                        {agent?.name ?? "Agent"} · {run.id} · {run.currentStep}
                    </div>
                </div>
            </div>
            <div className="run-right">
                <span className={statusClass(run.status)}>{run.status}</span>
                <div className="run-time">{run.duration}</div>
            </div>
        </div>
    );
}
