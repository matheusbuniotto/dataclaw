import { Link } from "wouter";
import {
    ArrowRight,
    Bot,
    CheckCircle2,
    Database,
    FileClock,
    Plus,
    ShieldCheck,
    Sparkles,
    Workflow,
} from "lucide-react";
import type { DataSource, Run, WorkspaceAgent, WorkspaceSnapshot } from "../state/workspace-types";
import { Header, Metric, Panel, RunRow } from "../components/Chrome";
import { statusClass } from "../components/view-model";

const STARTERS = [
    "Explore the Databricks workspace: list catalogs, pick a table, and profile it.",
    "Profile sample-data/customer_churn.csv and tell me what is worth testing.",
    "Summarize the current plan, findings, and playbook.",
    "Create a researcher named churn-analyst and have them profile sample-data/customer_churn.csv.",
];

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
                    <button className="button-primary" onClick={openLaunch} disabled={!snapshot || asking}>
                        <Plus size={15} /> Start a task
                    </button>
                }
            />

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
                            <Link href="/prototype/runs" className="text-link">
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
                            <Link href="/prototype/data" className="text-link">
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
