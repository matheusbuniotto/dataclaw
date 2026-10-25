import type { ReactNode } from "react";
import { Link } from "wouter";
import {
    ArrowRight,
    Bot,
    CheckCircle2,
    Database,
    FileClock,
    FileText,
    Gauge,
    Plus,
    ShieldCheck,
    Sparkles,
    Workflow,
} from "lucide-react";
import type { DataSource, Run, WorkspaceAgent, WorkspaceSnapshot } from "../state/workspace-types";
import { Header } from "../components/Header";
import { agentById, statusClass } from "../components/view-model";
import { STARTER_QUERIES as STARTERS } from "../components/starters";

export function Overview({
    snapshot,
    agents,
    runs,
    sources,
    openLaunch,
    ask,
    asking,
    inspect,
    ops,
}: {
    snapshot: WorkspaceSnapshot | null;
    agents: WorkspaceAgent[];
    runs: Run[];
    sources: DataSource[];
    openLaunch: () => void;
    ask: (goal: string) => void;
    asking: boolean;
    inspect: (id: string) => void;
    ops: boolean;
}) {
    const active = runs.filter((run) => run.status === "Running").length;
    const specialists = (snapshot?.roster ?? []).filter((agent) => agent.status === "active");
    const attention = sources.filter((source) => source.status === "Warning").length;
    const today = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
    }).toUpperCase();
    const goal = snapshot?.plan.goal;
    const agentName = snapshot?.agent.name ?? "DataClaw";
    const subtitle = !snapshot
        ? "Opening the durable agent…"
        : goal && goal !== "Pending goal definition"
            ? goal
            : `Ask ${agentName} to explore a local file or the Databricks workspace. Each turn is stored in SQLite.`;
    const activity = snapshot?.activity ?? [];

    return (
        <div className="page-wrap">
            <Header
                eyebrow={`${today} · ${agentName.toUpperCase()}`}
                title={snapshot?.agent.working ? `${agentName} is working.` : `${agentName} is ready.`}
                subtitle={subtitle}
                action={
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <a
                            href="/api/report?format=html"
                            target="_blank"
                            rel="noreferrer"
                            className="button-secondary"
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
                            title="Export Executive Intelligence Briefing"
                        >
                            <FileText size={14} /> Briefing
                        </a>
                        <button className="button-primary" onClick={openLaunch} disabled={!snapshot || asking}>
                            <Plus size={15} /> Start a task
                        </button>
                    </div>
                }
            />

            <div className="platform-highlights-bar">
                <div className="highlight-pill">
                    <Database size={13} style={{ color: "var(--green, #10b981)" }} />
                    <span>Lakehouse Engine:</span>
                    <b>Unity Catalog MCP + Serverless SQL</b>
                </div>
                <div className="highlight-pill">
                    <ShieldCheck size={13} style={{ color: "var(--indigo, #6366f1)" }} />
                    <span>Skeptical Auditor:</span>
                    <b>Cohen's κ = 0.701 (Calibrated LLM Judge)</b>
                </div>
                <div className="highlight-pill">
                    <Workflow size={13} style={{ color: "#ff5e57" }} />
                    <span>Databricks Suite:</span>
                    <b>MLflow · Genie · system.ai · Federation</b>
                </div>
                <div className="highlight-pill">
                    <Sparkles size={13} style={{ color: "var(--amber, #f59e0b)" }} />
                    <span>Resilience:</span>
                    <b>Pi Durable Checkpoints & Zero Egress</b>
                </div>
            </div>

            <div className="metric-grid">
                <Metric
                    icon={Bot}
                    label="Agents"
                    value={`${1 + specialists.length}`}
                    foot={specialists.length > 0
                        ? `<b>${specialists.slice(0, 3).map((agent) => agent.name).join(", ")}</b>`
                        : snapshot?.agent.working
                            ? "<b>Working</b> on the current turn"
                            : `<b>${agentName}</b> is the active agent`}
                />
                <Metric
                    icon={Workflow}
                    label="Durable runs"
                    value={`${runs.length}`}
                    foot={active ? `<b>${active} in flight</b>` : "No turn in flight"}
                />
                <Metric
                    icon={Database}
                    label="Data sources"
                    value={`${sources.length}`}
                    foot={attention ? `<b>${attention} need a check</b>` : "Local files and the warehouse"}
                />
                <Metric
                    icon={ShieldCheck}
                    label="Playbook"
                    value={`v${snapshot?.playbookVersion ?? "–"}`}
                    foot={`<b>${snapshot?.findingsCount ?? 0} findings</b> on record`}
                />
            </div>

            <div className="dashboard-grid">
                <div className="stack">
                    <Panel
                        title="Work in motion"
                        note="Turns in the active context. Older turns stay in SQLite after compaction."
                        action={
                            <Link href="/console/runs" className="text-link">
                                View all runs <ArrowRight size={12} style={{ verticalAlign: "middle" }} />
                            </Link>
                        }
                    >
                        {runs.length === 0 ? (
                            <div className="empty-state">
                                <Workflow size={22} />
                                <b>No turns yet</b>
                                <span>Start a task and {agentName} will explore from here.</span>
                            </div>
                        ) : (
                            runs.slice(0, 4).map((run) => (
                                <RunRow key={run.id} run={run} agents={agents} onClick={() => inspect(run.id)} />
                            ))
                        )}
                    </Panel>

                    <Panel
                        title={ops ? "Connected sources" : "Your data"}
                        note={ops ? "Live Databricks catalogs, local files, and durable documents." : `What ${agentName} can read right now.`}
                        action={
                            <Link href="/console/data" className="text-link">
                                Explore data <ArrowRight size={12} style={{ verticalAlign: "middle" }} />
                            </Link>
                        }
                    >
                        {sources.slice(0, 4).map((source) => (
                            <div className="health-row" key={source.id}>
                                <span className="health-icon">
                                    <Database size={13} />
                                </span>
                                <span className="health-copy">
                                    <b>{source.name}</b>
                                    <span>{source.freshness} · {source.records}</span>
                                </span>
                                <span className={statusClass(source.status)}>{source.status}</span>
                            </div>
                        ))}
                    </Panel>
                </div>

                <div className="stack">
                    <Panel title="Recent activity" note="From the active transcript.">
                        {activity.length === 0 ? (
                            <div className="empty-state">
                                <FileClock size={22} />
                                <b>Nothing has been asked yet</b>
                                <span>Activity shows up after the first turn.</span>
                            </div>
                        ) : activity.map((item, index) => {
                            const Icon = item.kind === "ask" ? Sparkles : item.kind === "tool" ? Workflow : item.kind === "document" ? FileClock : CheckCircle2;
                            return (
                                <div className="activity-item" key={`${item.time}-${index}`}>
                                    <span className="activity-marker">
                                        <Icon size={13} />
                                    </span>
                                    <span className="activity-copy">{item.text}</span>
                                    <span className="activity-date">{item.time}</span>
                                </div>
                            );
                        })}
                    </Panel>

                    <Panel title="A good place to start" note={`These go straight to ${agentName}.`}>
                        {STARTERS.map((prompt) => (
                            <div className="health-row" key={prompt}>
                                <span className="run-glyph">
                                    <Sparkles size={14} />
                                </span>
                                <span className="health-copy">
                                    <b>{prompt}</b>
                                </span>
                                <button
                                    className="icon-button"
                                    onClick={() => ask(prompt)}
                                    disabled={asking}
                                    aria-label={`Ask ${agentName}`}
                                >
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        ))}
                    </Panel>

                </div>
            </div>
        </div>
    );
}

// The overview's own presentational pieces: they were in `components/Chrome.tsx` next to `Header`,
// but only this page renders them, so they live here until a second page needs one.

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
