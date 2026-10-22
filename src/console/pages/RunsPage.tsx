import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
    Check,
    CirclePause,
    Database,
    FileClock,
    RefreshCw,
    Search,
} from "lucide-react";
import type { Run, WorkspaceAgent } from "../state/workspace-types";
import { Header } from "../components/Chrome";
import { agentById, statusClass } from "../components/view-model";

export function RunsPage({
    runs,
    agents,
    changeRun,
    notify,
}: {
    runs: Run[];
    agents: WorkspaceAgent[];
    changeRun: (id: string, action: "stop" | "retry") => void;
    notify: (s: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("All statuses");
    const [, setLocation] = useLocation();

    const initialSelected =
        typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("selected")
            : null;
    const [selected, setSelected] = useState<string | null>(initialSelected);

    const filtered = useMemo(
        () =>
            runs.filter(
                (r) =>
                    (r.goal + r.id + (agentById(r.agentId, agents)?.name ?? ""))
                        .toLowerCase()
                        .includes(query.toLowerCase()) &&
                    (filter === "All statuses" || r.status === filter)
            ),
        [runs, agents, query, filter]
    );

    const run = filtered.find((r) => r.id === selected) ?? (selected ? undefined : filtered[0]);
    const selectedAgent = run && agentById(run.agentId, agents);

    const select = (id: string) => {
        setSelected(id);
        setLocation(`/prototype/runs?selected=${id}`);
    };

    return (
        <div className="page-wrap">
            <Header
                eyebrow="CONTINUOUS WORK"
                title="Durable runs"
                subtitle="Each run keeps its history, checkpoints, and place in the work."
            />

            <div className="toolbar">
                <div className="search-box">
                    <Search size={15} />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search runs, goals, or agents"
                    />
                </div>
                <select
                    className="filter-select"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                >
                    <option>All statuses</option>
                    <option>Running</option>
                    <option>Completed</option>
                    <option>Failed</option>
                </select>
                <button
                    className="button-secondary"
                    onClick={() => {
                        setQuery("");
                        setFilter("All statuses");
                        notify("Run filters cleared.");
                    }}
                >
                    <RefreshCw size={13} /> Reset
                </button>
            </div>

            <div className="detail-layout">
                <section className="panel">
                    <div className="panel-head">
                        <div>
                            <h2 className="panel-title">Run history</h2>
                            <div className="panel-note">
                                {filtered.length} runs · most recent first
                            </div>
                        </div>
                        <span className="chip">Pi Durable SQLite WAL</span>
                    </div>
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Goal</th>
                                    <th>Agent</th>
                                    <th>Status</th>
                                    <th>Started</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => (
                                    <tr
                                        key={r.id}
                                        onClick={() => select(r.id)}
                                        style={{
                                            background: run?.id === r.id ? "#f2f5ec" : undefined,
                                        }}
                                    >
                                        <td className="table-strong">
                                            {r.goal}
                                            <div className="mono" style={{ marginTop: 4 }}>
                                                {r.id}
                                            </div>
                                        </td>
                                        <td>{agentById(r.agentId, agents)?.name}</td>
                                        <td>
                                            <span className={statusClass(r.status)}>{r.status}</span>
                                        </td>
                                        <td className="mono">{r.startedAt}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filtered.length === 0 && (
                            <div className="empty-state">
                                <Search size={22} />
                                <b>No runs found</b>
                                <span>Adjust the search or status filter.</span>
                            </div>
                        )}
                    </div>
                </section>

                {run ? (
                    <section className="panel detail-card">
                        <div className="detail-heading">
                            <div>
                                <div className="eyebrow">
                                    {run.id} · {selectedAgent?.name}
                                </div>
                                <h2 className="detail-title">{run.goal}</h2>
                                <div className="detail-sub">
                                    Started {run.startedAt} · Active time {run.duration}
                                </div>
                            </div>
                            <span className={statusClass(run.status)}>{run.status}</span>
                        </div>

                        {run.error && (
                            <div
                                style={{
                                    marginTop: 14,
                                    padding: 12,
                                    borderRadius: 8,
                                    background: "#faf0e8",
                                    color: "#8b5d47",
                                    fontSize: 10,
                                    lineHeight: 1.5,
                                }}
                            >
                                <b>Needs attention</b>
                                <br />
                                {run.error}
                            </div>
                        )}

                        <div className="detail-actions" style={{ marginTop: 15 }}>
                            {run.status === "Running" ? (
                                <button
                                    className="button-secondary"
                                    onClick={() => changeRun(run.id, "stop")}
                                >
                                    <CirclePause size={13} /> Stop
                                </button>
                            ) : (
                                <button
                                    className="button-primary"
                                    onClick={() => changeRun(run.id, "retry")}
                                >
                                    <RefreshCw size={13} /> Ask again
                                </button>
                            )}
                        </div>

                        <div className="section-label">Saved checkpoints</div>
                        <div className="step-list">
                            {run.checkpoints.map((cp) => (
                                <div className="step" key={cp.id}>
                                    <span className={`step-marker ${cp.state}`}>
                                        <Check size={12} />
                                    </span>
                                    <span className="step-copy">
                                        <b>{cp.label}</b>
                                        <span>{cp.summary}</span>
                                    </span>
                                    <span className="step-time">{cp.timestamp}</span>
                                </div>
                            ))}
                        </div>

                        <div className="section-label">Connected data</div>
                        <div className="data-chips">
                            {run.dataSources.map((s) => (
                                <span key={s} className="chip">
                                    <Database
                                        size={10}
                                        style={{ verticalAlign: "-2px", marginRight: 4 }}
                                    />
                                    {s}
                                </span>
                            ))}
                        </div>
                        <div className="panel-note" style={{ marginTop: 13 }}>
                            Latest event · {run.event}
                        </div>
                    </section>
                ) : (
                    <div className="panel empty-state">
                        <FileClock size={22} />
                        <b>Select a run to inspect its history</b>
                        <span>Checkpoints and source context appear here.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
