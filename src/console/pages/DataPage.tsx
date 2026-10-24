import { useState } from "react";
import {
    ArrowRight,
    Bot,
    Database,
    Search,
    ShieldCheck,
    Workflow,
} from "lucide-react";
import type { DataSource, Run } from "../state/workspace-types";
import { Header } from "../components/Header";
import { statusClass } from "../components/view-model";

export function DataPage({
    sources,
    runs,
    ops,
    inspect,
    onConnect,
}: {
    sources: DataSource[];
    runs: Run[];
    ops: boolean;
    inspect: (id: string) => void;
    onConnect: () => void;
}) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("All sources");
    const [selected, setSelected] = useState<string | null>(null);

    const filtered = sources.filter(
        (s) =>
            (s.name + s.type + s.agents.join(" ")).toLowerCase().includes(query.toLowerCase()) &&
            (filter === "All sources" || s.status === filter)
    );
    const source = filtered.find((s) => s.id === selected) ?? filtered[0];

    return (
        <div className="page-wrap">
            <Header
                eyebrow="CONNECTED DATA"
                title="Data health"
                subtitle={
                    ops
                        ? "Databricks catalogs, local files, and the durable documents DataClaw writes."
                        : "See what DataClaw can read, and which turns used it."
                }
                action={
                    <button className="button-secondary" onClick={onConnect}>
                        <Database size={14} /> Connect Databricks
                    </button>
                }
            />

            <div className="source-grid">
                {sources.slice(0, 3).map((s) => (
                    <div className="panel source-card" key={s.id}>
                        <div className="source-top">
                            <span className="source-icon">
                                <Database size={16} />
                            </span>
                            <span style={{ flex: 1 }}>
                                <div className="source-name">{s.name}</div>
                                <div className="source-type">{s.type}</div>
                            </span>
                            <span className={statusClass(s.status)}>{s.status}</span>
                        </div>
                        <div className="source-stats">
                            <div className="source-stat">
                                <span>Freshness</span>
                                <b>{s.freshness}</b>
                            </div>
                            <div className="source-stat">
                                <span>Records</span>
                                <b>{s.records}</b>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="toolbar">
                <div className="search-box">
                    <Search size={15} />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search sources or downstream agents"
                    />
                </div>
                <select
                    className="filter-select"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                >
                    <option>All sources</option>
                    <option>Healthy</option>
                    <option>Warning</option>
                    <option>Connected</option>
                </select>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#87938a" }}>
                    Read from the live session
                </span>
            </div>

            <div className="detail-layout">
                <section className="panel">
                    <div className="panel-head">
                        <div>
                            <h2 className="panel-title">Connected sources</h2>
                            <div className="panel-note">What is actually connected</div>
                        </div>
                    </div>
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Source</th>
                                    <th>Status</th>
                                    <th>Freshness</th>
                                    <th>Records</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((s) => (
                                    <tr
                                        key={s.id}
                                        onClick={() => setSelected(s.id)}
                                        className={source?.id === s.id ? "is-selected" : undefined}
                                    >
                                        <td className="table-strong">
                                            {s.name}
                                            <div className="mono" style={{ marginTop: 4 }}>
                                                {s.type}
                                            </div>
                                        </td>
                                        <td>
                                            <span className={statusClass(s.status)}>{s.status}</span>
                                        </td>
                                        <td>{s.freshness}</td>
                                        <td className="mono">{s.records}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filtered.length === 0 && (
                            <div className="empty-state">
                                <Database size={22} />
                                <b>No sources match</b>
                                <span>Try a different search or status.</span>
                            </div>
                        )}
                    </div>
                </section>

                {source ? (
                    <section className="panel detail-card">
                        <div className="detail-heading">
                            <div>
                                <div className="eyebrow">SOURCE PROFILE</div>
                                <h2 className="detail-title">{source.name}</h2>
                                <div className="detail-sub">{source.type}</div>
                            </div>
                            <span className={statusClass(source.status)}>{source.status}</span>
                        </div>

                        <div className="source-stats" style={{ marginTop: 16 }}>
                            <div className="source-stat">
                                <span>Latest refresh</span>
                                <b>{source.freshness}</b>
                            </div>
                            <div className="source-stat">
                                <span>Records available</span>
                                <b>{source.records}</b>
                            </div>
                        </div>

                        <div
                            style={{
                                marginTop: 14,
                                padding: "9px 12px",
                                background: "rgba(16, 185, 129, 0.07)",
                                border: "1px solid rgba(16, 185, 129, 0.22)",
                                borderRadius: 8,
                                fontSize: 11,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <ShieldCheck size={14} style={{ color: "var(--green, #10b981)", flexShrink: 0 }} />
                            <span style={{ color: "#cbd5e1", lineHeight: 1.4 }}>
                                <strong>Safe Data Engine:</strong> Read-only query execution enforced by AST validation. Mutations (DROP, DELETE, UPDATE, ALTER) fail closed.
                            </span>
                        </div>

                        <div className="section-label">Lineage · downstream agents</div>
                        <div className="lineage">
                            <span className="lineage-node">
                                <Database size={13} />
                                {source.name}
                            </span>
                            <span className="lineage-arrow">
                                <ArrowRight size={13} />
                            </span>
                            {source.agents.map((name) => (
                                <span className="lineage-node" key={name}>
                                    <Bot size={13} />
                                    {name}
                                </span>
                            ))}
                        </div>

                        <div className="section-label">Affected runs</div>
                        {source.runs.length ? (
                            source.runs.map((id) => {
                                const r = runs.find((item) => item.id === id);
                                return (
                                    r && (
                                        <div className="health-row" key={id}>
                                            <span className="run-glyph">
                                                <Workflow size={13} />
                                            </span>
                                            <span className="health-copy">
                                                <b>{r.goal}</b>
                                                <span>
                                                    {id} · {r.currentStep}
                                                </span>
                                            </span>
                                            <button className="text-link" onClick={() => inspect(id)}>
                                                Inspect <ArrowRight size={12} />
                                            </button>
                                        </div>
                                    )
                                );
                            })
                        ) : (
                            <div className="panel-note">No recent runs use this source.</div>
                        )}
                    </section>
                ) : (
                    <div className="panel empty-state">
                        <Database size={22} />
                        <b>Select a source to inspect lineage</b>
                        <span>Downstream agents and affected runs will appear here.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
