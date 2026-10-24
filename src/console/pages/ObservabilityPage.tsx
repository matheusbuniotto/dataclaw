import { useEffect, useState } from "react";
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    Award,
    BarChart2,
    CheckCircle2,
    DollarSign,
    Gauge,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    TrendingUp,
    Zap,
} from "lucide-react";
import { Header } from "../components/Header";
import type { ObservabilitySummary } from "../api/observability-api";

export function ObservabilityPage({
    notify,
}: {
    notify?: (message: string) => void;
}) {
    const [data, setData] = useState<ObservabilitySummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [emittingTrace, setEmittingTrace] = useState(false);
    const [targetMde, setTargetMde] = useState<3 | 5 | 10>(5);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/observability");
            if (!res.ok) throw new Error("Failed to load observability metrics");
            const json = (await res.json()) as ObservabilitySummary;
            setData(json);
            setError("");
        } catch (e: any) {
            setError(e.message || "Could not load metrics");
        } finally {
            setLoading(false);
        }
    };

    const emitTestTrace = async () => {
        setEmittingTrace(true);
        try {
            const res = await fetch("/api/observability/trace", { method: "POST" });
            if (!res.ok) throw new Error("Trace emission failed");
            notify?.("Trace emitted to LangWatch buffer");
            await loadData();
        } catch (e: any) {
            notify?.(e.message || "Failed to emit trace");
        } finally {
            setEmittingTrace(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, []);

    return (
        <div className="page-wrap">
            <Header
                eyebrow="PRODUCTION EVALS & AGENT OBSERVABILITY"
                title="Agent Intelligence & Growth Flywheel"
                subtitle="End-to-end evaluation, clustered power calculations, LangWatch tracing, and telemetry-driven funnel attribution."
                action={
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span
                            className={data?.langwatch.configured ? "badge badge-success" : "badge badge-primary"}
                            style={{ fontSize: 12, padding: "5px 10px" }}
                            title={data?.langwatch.configured ? "Streaming to LangWatch Cloud" : "Buffering traces in-memory"}
                        >
                            <Activity size={13} style={{ display: "inline", marginRight: 4 }} />
                            {data?.langwatch.configured ? "LangWatch Live" : "LangWatch (Buffered)"}
                        </span>
                        <button
                            className="button-primary"
                            onClick={() => void emitTestTrace()}
                            disabled={emittingTrace}
                            title="Emit a simulated agent trace to LangWatch OpenTelemetry collector"
                        >
                            <Zap size={14} /> {emittingTrace ? "Emitting…" : "Emit Test Trace"}
                        </button>
                        <button className="button-secondary" onClick={() => void loadData()} disabled={loading}>
                            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
                        </button>
                    </div>
                }
            />

            {error && (
                <div className="panel" style={{ padding: 16, borderColor: "var(--red)", color: "var(--red)", marginBottom: 16 }}>
                    <ShieldAlert size={16} style={{ display: "inline", marginRight: 8 }} />
                    {error}
                </div>
            )}

            {/* Top Stat KPI Row */}
            <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
                <div className="panel" style={{ padding: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Candidate Success</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--green)", marginTop: 4 }}>
                        {data ? `${(data.evals.candidateSuccessRate * 100).toFixed(1)}%` : "..."}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        +6.7 pp vs baseline [95% CI]
                    </div>
                </div>

                <div className="panel" style={{ padding: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Stuck Rate Reduction</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--green)", marginTop: 4 }}>
                        {data ? `-${data.evals.stuckReductionPp.toFixed(1)} pp` : "..."}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        26.7% down to 2.2% (loops resolved)
                    </div>
                </div>

                <div className="panel" style={{ padding: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>User Activation Lift</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--indigo, #6366f1)", marginTop: 4 }}>
                        {data ? `+${data.growth.activationUpliftPp.toFixed(1)} pp` : "..."}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        Direct funnel impact of low stuck rate
                    </div>
                </div>

                <div className="panel" style={{ padding: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Projected ARR Delta</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--amber, #f59e0b)", marginTop: 4 }}>
                        {data ? data.growth.projectedArrDelta : "..."}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        Per 10,000 monthly active users
                    </div>
                </div>
            </div>

            {/* Main 2-Column Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Panel 1: Agent Evaluation Rigor */}
                <div className="panel" style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Gauge size={18} color="var(--indigo, #6366f1)" />
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Offline Eval & Statistical Rigor</h3>
                        </div>
                        <span className="badge badge-success" style={{ fontSize: 11 }}>SRM: p = 1.000</span>
                    </div>

                    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                                <th style={{ padding: "8px 4px", color: "var(--muted)" }}>Metric</th>
                                <th style={{ padding: "8px 4px", color: "var(--muted)" }}>Baseline</th>
                                <th style={{ padding: "8px 4px", color: "var(--muted)" }}>Candidate</th>
                                <th style={{ padding: "8px 4px", color: "var(--muted)" }}>Uplift / Check</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "8px 4px", fontWeight: 500 }}>Success Rate</td>
                                <td style={{ padding: "8px 4px" }}>84.4%</td>
                                <td style={{ padding: "8px 4px", fontWeight: 600, color: "var(--green)" }}>91.1%</td>
                                <td style={{ padding: "8px 4px" }}>+6.7 pp [-11.1, +24.4]</td>
                            </tr>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "8px 4px", fontWeight: 500 }}>Stuck Rate</td>
                                <td style={{ padding: "8px 4px", color: "var(--red)" }}>26.7%</td>
                                <td style={{ padding: "8px 4px", fontWeight: 600, color: "var(--green)" }}>2.2%</td>
                                <td style={{ padding: "8px 4px", color: "var(--green)" }}>-24.4 pp (p &lt; 0.01)</td>
                            </tr>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "8px 4px", fontWeight: 500 }}>Cohen's h Effect Size</td>
                                <td style={{ padding: "8px 4px" }}>—</td>
                                <td style={{ padding: "8px 4px" }}>—</td>
                                <td style={{ padding: "8px 4px", fontWeight: 600 }}>h = 0.21 (Small-to-medium)</td>
                            </tr>
                            <tr>
                                <td style={{ padding: "8px 4px", fontWeight: 500 }}>Sample Ratio (SRM)</td>
                                <td style={{ padding: "8px 4px" }}>45 runs</td>
                                <td style={{ padding: "8px 4px" }}>45 runs</td>
                                <td style={{ padding: "8px 4px", color: "var(--green)" }}>χ² = 0.00 (Pass)</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style={{ marginTop: 16, padding: 12, background: "rgba(99, 102, 241, 0.05)", borderRadius: 6, fontSize: 12 }}>
                        <strong>Clustered Resampling Note:</strong> Repeats of the same task are clustered. DataClaw resamples <em>tasks</em> (not runs) across 2,000 bootstrap draws, avoiding false-positive significance.
                    </div>
                </div>

                {/* Panel 2: Experiment Power Analysis & Shipping Decision Gate */}
                <div className="panel" style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Zap size={18} color="var(--amber, #f59e0b)" />
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Experiment Shipping Gate (Statistical Power)</h3>
                        </div>
                        <span className="badge badge-warning" style={{ fontSize: 11 }}>
                            {data?.power.shippingVerdict ?? "UNDERPOWERED"}
                        </span>
                    </div>

                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: "var(--muted)" }}>Intra-Cluster Correlation (ICC):</span>
                            <strong>{data?.power.icc.toFixed(3) ?? "0.150"}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: "var(--muted)" }}>Variance Inflation Factor (VIF):</span>
                            <strong>{data?.power.designEffect.toFixed(2) ?? "1.60"}x</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: "var(--muted)" }}>Current MDE (80% Power, N=9):</span>
                            <strong style={{ color: "var(--amber, #f59e0b)" }}>±{data?.power.currentMdePp.toFixed(1) ?? "29.9"} pp</strong>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: "var(--muted)" }}>Target Shipping MDE:</span>
                            <div style={{ display: "flex", gap: 4 }}>
                                {([3, 5, 10] as const).map((mde) => (
                                    <button
                                        key={mde}
                                        type="button"
                                        onClick={() => setTargetMde(mde)}
                                        style={{
                                            padding: "2px 8px",
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            border: targetMde === mde ? "1px solid #ff5e57" : "1px solid #252e40",
                                            background: targetMde === mde ? "rgba(255, 94, 87, 0.15)" : "transparent",
                                            color: targetMde === mde ? "#ffffff" : "var(--muted)",
                                            cursor: "pointer",
                                            transition: "all 0.12s ease",
                                        }}
                                    >
                                        ±{mde} pp
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: "var(--muted)" }}>Tasks Needed for ±{targetMde} pp MDE:</span>
                            <strong style={{ color: "var(--green, #10b981)" }}>
                                {targetMde === 3 ? "803 tasks" : targetMde === 5 ? `${data?.power.tasksNeededFor5pp ?? 289} tasks` : "72 tasks"} (at m=5)
                            </strong>
                        </div>
                    </div>

                    <div style={{ marginTop: 16, padding: 12, background: "rgba(245, 158, 11, 0.08)", borderRadius: 6, fontSize: 12, borderLeft: "3px solid var(--amber, #f59e0b)" }}>
                        <strong>Shipping Recommendation:</strong> {data?.power.shippingExplanation}
                        <br /><span style={{ color: "var(--muted)" }}>Do not ship solely on noisy task splits; use proxy metrics (stuck rate -24.4 pp) for canary gating.</span>
                    </div>
                </div>

                {/* Panel 3: Growth Funnel & Unit Economics */}
                <div className="panel" style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <TrendingUp size={18} color="var(--green)" />
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>End-to-End Product Growth Funnel</h3>
                        </div>
                        <span className="badge badge-success" style={{ fontSize: 11 }}>10k Cohort</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {data?.growth.stages.map((st, i) => (
                            <div key={i} style={{ fontSize: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                    <span style={{ fontWeight: 500 }}>{st.stage}</span>
                                    <span>
                                        <strong style={{ color: "var(--muted)" }}>{st.controlUsers.toLocaleString()}</strong> → <strong style={{ color: "var(--green)" }}>{st.treatmentUsers.toLocaleString()}</strong>
                                    </span>
                                </div>
                                <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                                    <div
                                        style={{
                                            width: `${(st.treatmentUsers / (data?.growth.cohortSize || 10000)) * 100}%`,
                                            height: "100%",
                                            background: i === 2 ? "var(--indigo, #6366f1)" : i === 3 ? "var(--green)" : "var(--blue, #3b82f6)",
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 12 }}>
                        <strong>Top Growth Lever:</strong> {data?.growth.topOpportunity.title}
                        <div style={{ color: "var(--green)", fontWeight: 600, marginTop: 2 }}>
                            {data?.growth.topOpportunity.estimatedArr} · {data?.growth.topOpportunity.experiment}
                        </div>
                    </div>
                </div>

                {/* Panel 4: LLM Judge & Skeptical Auditor Calibration */}
                <div className="panel" style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <ShieldCheck size={18} color="var(--indigo, #6366f1)" />
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Auditor LLM-as-a-Judge Calibration</h3>
                        </div>
                        <span className="badge badge-primary" style={{ fontSize: 11 }}>κ = {data?.auditor.cohensKappa.toFixed(3) ?? "0.701"}</span>
                    </div>

                    <div style={{ fontSize: 13, marginBottom: 12 }}>
                        DataClaw's Auditor subagent reviews all findings for p-hacking, Simpson's Paradox, and small sample noise ($N &lt; 30$).
                        Blind human calibration confirms: <strong>{data?.auditor.agreementLevel}</strong>.
                    </div>

                    <div style={{ background: "var(--bg-subtle, rgba(255,255,255,0.02))", padding: 12, borderRadius: 6, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
                            Confusion Matrix (Human vs Auditor)
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "80px repeat(3, 1fr)", gap: 4, textAlign: "center", fontSize: 12 }}>
                            <div style={{ textAlign: "left", color: "var(--muted)" }}>Human ↓</div>
                            <div style={{ fontWeight: 600, color: "var(--green)" }}>Conf.</div>
                            <div style={{ fontWeight: 600, color: "var(--amber, #f59e0b)" }}>Caut.</div>
                            <div style={{ fontWeight: 600, color: "var(--red)" }}>Rej.</div>

                            <div style={{ textAlign: "left", fontWeight: 500 }}>Confirmed</div>
                            <div style={{ padding: 4, background: "rgba(16, 185, 129, 0.15)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[0]?.[0] ?? 2}</div>
                            <div style={{ padding: 4, background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[0]?.[1] ?? 1}</div>
                            <div style={{ padding: 4, background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[0]?.[2] ?? 0}</div>

                            <div style={{ textAlign: "left", fontWeight: 500 }}>Caution</div>
                            <div style={{ padding: 4, background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[1]?.[0] ?? 0}</div>
                            <div style={{ padding: 4, background: "rgba(245, 158, 11, 0.15)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[1]?.[1] ?? 3}</div>
                            <div style={{ padding: 4, background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[1]?.[2] ?? 0}</div>

                            <div style={{ textAlign: "left", fontWeight: 500 }}>Rejected</div>
                            <div style={{ padding: 4, background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[2]?.[0] ?? 1}</div>
                            <div style={{ padding: 4, background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[2]?.[1] ?? 0}</div>
                            <div style={{ padding: 4, background: "rgba(239, 68, 68, 0.15)", borderRadius: 4 }}>{data?.auditor.confusionMatrix[2]?.[2] ?? 3}</div>
                        </div>
                    </div>

                    <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted)" }}>
                        Labeling is performed blind via <code>bun run evals:calibrate export</code> without auditor verdicts to prevent anchoring bias.
                    </div>
                </div>
            </div>

            {/* Section 3: Live LangWatch OpenTelemetry Trace Stream */}
            <div className="panel" style={{ marginTop: 24, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Activity size={18} color="#ff5e57" />
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>LangWatch OpenTelemetry Trace Stream</h3>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Live telemetry pipeline capturing multi-turn conversation chains, tool execution spans, and auditor evaluations.
                            </div>
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="badge badge-primary" style={{ fontSize: 11 }}>
                            {data?.langwatch.bufferedCount ?? 0} traces buffered
                        </span>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                            {data?.langwatch.endpoint}
                        </span>
                    </div>
                </div>

                {(!data?.langwatch.recentTraces || data.langwatch.recentTraces.length === 0) ? (
                    <div className="empty-state" style={{ padding: "30px 10px" }}>
                        <Activity size={24} style={{ color: "var(--muted)", marginBottom: 8 }} />
                        <b>No traces in buffer yet</b>
                        <span>Click "Emit Test Trace" above or run an agent conversation to stream spans here.</span>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {data.langwatch.recentTraces.map((tr) => (
                            <div
                                key={tr.trace_id}
                                style={{
                                    background: "rgba(255, 255, 255, 0.025)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 10,
                                    padding: "12px 16px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 16,
                                }}
                            >
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc" }}>
                                            {tr.trace_id}
                                        </span>
                                        <span className="badge badge-primary" style={{ fontSize: 10 }}>
                                            {tr.agent_id ?? "dataclaw"}
                                        </span>
                                        {tr.stuck && (
                                            <span className="badge badge-warning" style={{ fontSize: 10 }}>
                                                Stuck Guardrail
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {tr.goal || "Agent execution cycle"}
                                    </div>
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                                    <div style={{ display: "flex", gap: 4 }}>
                                        {tr.spanTypes.map((type) => (
                                            <span
                                                key={type}
                                                className="chip"
                                                style={{
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                    textTransform: "uppercase",
                                                    color: type === "tool" ? "var(--green)" : type === "eval" ? "var(--indigo, #6366f1)" : "#ff6e67",
                                                }}
                                            >
                                                {type}
                                            </span>
                                        ))}
                                    </div>
                                    <div style={{ textAlign: "right", minWidth: 90 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc" }}>
                                            {tr.durationMs > 0 ? `${tr.durationMs}ms` : "—"}
                                        </div>
                                        <div style={{ fontSize: 10, color: "var(--muted)" }}>
                                            {tr.totalTokens > 0 ? `${tr.totalTokens.toLocaleString()} tok` : tr.timestamp}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
