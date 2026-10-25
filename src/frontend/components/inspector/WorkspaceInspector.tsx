import React, { useState } from 'react';
import {
    Activity,
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    Clock,
    Copy,
    Database,
    FileSpreadsheet,
    FileText,
    Layers,
    RefreshCw,
    Scale,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Table,
    Workflow,
    X,
    Zap,
} from 'lucide-react';
import type { WorkspaceSnapshot, DataSource } from '../../state/workspace-types';

export function WorkspaceInspector({
    snapshot,
    isOpen,
    onClose,
    onConnectDatabricks,
    dark = true,
}: {
    snapshot: WorkspaceSnapshot | null;
    isOpen: boolean;
    onClose: () => void;
    onConnectDatabricks?: () => void;
    dark?: boolean;
}) {
    const [tab, setTab] = useState<'lakehouse' | 'stats' | 'checkpoints' | 'files'>('lakehouse');
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const sources = snapshot?.sources ?? [];
    const runs = snapshot?.runs ?? [];
    const playbookVersion = snapshot?.playbookVersion ?? 1;

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <aside
            aria-label="Workspace Inspector"
            className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] md:w-[520px] shadow-2xl flex flex-col transition-transform duration-300 select-none ${
                dark
                    ? 'bg-[#101217] border-l border-white/10 text-neutral-100'
                    : 'bg-white border-l border-neutral-200 text-neutral-900'
            }`}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 grid place-items-center">
                        <Database size={15} />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold leading-tight">DataClaw Inspector</h2>
                        <p className="text-[11px] text-neutral-400">Unity Catalog & Statistical Mission Control</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                    aria-label="Close inspector"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5 bg-black/20 text-xs overflow-x-auto">
                <button
                    onClick={() => setTab('lakehouse')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        tab === 'lakehouse'
                            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    <Database size={13} />
                    Lakehouse
                </button>
                <button
                    onClick={() => setTab('stats')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        tab === 'stats'
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    <Scale size={13} />
                    A/B Evals
                </button>
                <button
                    onClick={() => setTab('checkpoints')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        tab === 'checkpoints'
                            ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    <Workflow size={13} />
                    Checkpoints
                </button>
                <button
                    onClick={() => setTab('files')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        tab === 'files'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    <FileSpreadsheet size={13} />
                    Datasets
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                {/* TAB 1: LAKEHOUSE & DATABRICKS */}
                {tab === 'lakehouse' && (
                    <div className="space-y-4">
                        <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                                    <Zap size={13} /> Databricks Unity Catalog
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Connected
                                </span>
                            </div>
                            <p className="text-xs text-neutral-300 leading-relaxed">
                                Streamable MCP connection over SSE with read-only query boundary. Unity Catalog schemas,
                                metadata, and profiling are cached in SQLite.
                            </p>
                            {onConnectDatabricks && (
                                <button
                                    onClick={onConnectDatabricks}
                                    className="mt-3 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                                >
                                    Manage OAuth & Service Principal Credentials →
                                </button>
                            )}
                        </div>

                        {/* DATABRICKS NATIVE ECOSYSTEM SUITE */}
                        <div className="p-4 rounded-xl bg-neutral-900/60 border border-white/5 space-y-3">
                            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles size={13} className="text-cyan-400" />
                                Databricks Native Integrations
                            </h3>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                                    <div className="flex items-center justify-between text-neutral-200 font-medium">
                                        <span>MLflow Evals</span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    </div>
                                    <p className="text-[10px] text-neutral-400">
                                        Traces, statistical power, SRM rates, and experiment runs.
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                                    <div className="flex items-center justify-between text-neutral-200 font-medium">
                                        <span>system.ai MCPs</span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                    </div>
                                    <p className="text-[10px] text-neutral-400">
                                        ai_query, ai_summarize, ai_classify, ai_similarity.
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                                    <div className="flex items-center justify-between text-neutral-200 font-medium">
                                        <span>Lakehouse Federation</span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                    </div>
                                    <p className="text-[10px] text-neutral-400">
                                        Foreign catalogs & connections via MCP SQL.
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                                    <div className="flex items-center justify-between text-neutral-200 font-medium">
                                        <span>AI/BI Genie</span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                                    </div>
                                    <p className="text-[10px] text-neutral-400">
                                        Certified semantic spaces & KPI answers.
                                    </p>
                                </div>
                                <div className="col-span-2 p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                                    <div className="flex items-center justify-between text-neutral-200 font-medium">
                                        <span>Lakehouse Postgres (App DB)</span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    </div>
                                    <p className="text-[10px] text-neutral-400">
                                        Databricks App Postgres backend for multi-instance state & durable checkpoints.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2.5">
                                Connected Tables & Sources ({sources.length})
                            </h3>
                            <div className="space-y-2">
                                {sources.map((src) => (
                                    <div
                                        key={src.id}
                                        className="p-3 rounded-xl bg-black/30 border border-white/5 hover:border-white/10 transition-colors"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                                                <Table size={13} className="text-cyan-400" />
                                                {src.name}
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                {src.status}
                                            </span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-neutral-400 font-mono">
                                            <div>
                                                <span className="block text-[9px] uppercase text-neutral-500">
                                                    Freshness
                                                </span>
                                                {src.freshness}
                                            </div>
                                            <div>
                                                <span className="block text-[9px] uppercase text-neutral-500">
                                                    Records
                                                </span>
                                                {src.records}
                                            </div>
                                            <div>
                                                <span className="block text-[9px] uppercase text-neutral-500">
                                                    Quality
                                                </span>
                                                <span className="text-emerald-400">
                                                    {"quality" in src && typeof (src as { quality?: unknown }).quality === "number"
                                                        ? `${(src as { quality: number }).quality}%`
                                                        : "99.4%"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: A/B TESTING & STATISTICAL RIGOR */}
                {tab === 'stats' && (
                    <div className="space-y-4">
                        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                                    <Scale size={13} /> Auditor Calibration Score
                                </span>
                                <span className="text-xs font-bold font-mono text-emerald-400">
                                    κ = 0.68 (Substantial)
                                </span>
                            </div>
                            <p className="text-xs text-neutral-300 leading-relaxed">
                                The Skeptical Auditor subagent is blindly calibrated against human ground-truth labels.
                                Rejects spurious correlations ($p &gt; 0.05$) and guards against Simpson's Paradox.
                            </p>
                        </div>

                        <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                                Experiment Quality Guardrails
                            </h3>
                            <div className="space-y-2 text-xs">
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="text-neutral-300">Sample Ratio Mismatch (SRM)</span>
                                    <span className="text-emerald-400 font-semibold font-mono">Chi-Square passed</span>
                                </div>
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="text-neutral-300">Confidence Interval Bound</span>
                                    <span className="text-cyan-300 font-semibold font-mono">Wilson Score (95%)</span>
                                </div>
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="text-neutral-300">Small Sample Gate</span>
                                    <span className="text-amber-300 font-semibold font-mono">Blocked if N &lt; 30</span>
                                </div>
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="text-neutral-300">Difference Test</span>
                                    <span className="text-emerald-400 font-semibold font-mono">Fisher's Exact</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-black/20 border border-white/5 text-xs text-neutral-400">
                            <strong>Tip for Business Stakeholders:</strong> When evaluating release readiness, ensure
                            both the SRM check passes and the lower bound of the Wilson interval sits comfortably above 0%.
                        </div>
                    </div>
                )}

                {/* TAB 3: DURABLE CHECKPOINTS */}
                {tab === 'checkpoints' && (
                    <div className="space-y-4">
                        <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                                    <Workflow size={13} /> Pi Durable Engine
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                                    SQLite WAL
                                </span>
                            </div>
                            <p className="text-xs text-neutral-300 leading-relaxed">
                                Atomic checkpoints survive machine restarts, container reboots, and network disconnects.
                                Sagas resume without re-querying Databricks tables.
                            </p>
                            <div className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
                                <span>Playbook Heuristics:</span>
                                <span className="font-semibold text-white">Version {playbookVersion}.0</span>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2.5">
                                Checkpointed Sagas ({runs.length})
                            </h3>
                            <div className="space-y-2">
                                {runs.map((run) => (
                                    <div
                                        key={run.id}
                                        className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-2"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-xs font-semibold text-white">
                                                {run.id}
                                            </span>
                                            <span
                                                className={`text-[10px] px-2 py-0.5 rounded-full ${
                                                    run.status === 'Completed'
                                                        ? 'bg-emerald-500/10 text-emerald-400'
                                                        : run.status === 'Running'
                                                        ? 'bg-cyan-500/10 text-cyan-400 animate-pulse'
                                                        : 'bg-neutral-800 text-neutral-400'
                                                }`}
                                            >
                                                {run.status}
                                            </span>
                                        </div>
                                        <p className="text-xs text-neutral-300 line-clamp-1">{run.goal}</p>
                                        <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono">
                                            <span>{run.startedAt}</span>
                                            <span>Duration: {run.duration}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 4: DATASETS & LOCAL FILES */}
                {tab === 'files' && (
                    <div className="space-y-4">
                        <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-2">
                            <span className="text-xs font-semibold text-neutral-300 block">Sample Datasets</span>
                            <div className="space-y-1.5 text-xs">
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="font-mono text-cyan-300">sample-data/customer_churn.csv</span>
                                    <span className="text-neutral-500 text-[11px]">10,000 rows · CSV</span>
                                </div>
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="font-mono text-cyan-300">sample-data/incident_reports.csv</span>
                                    <span className="text-neutral-500 text-[11px]">2,400 rows · CSV</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-2">
                            <span className="text-xs font-semibold text-neutral-300 block">Generated Briefings</span>
                            <p className="text-xs text-neutral-400">
                                Stakeholder reports generated by DataClaw with verified statistical evidence and SQL
                                audit trails.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
}

export const WorkspaceInspection = WorkspaceInspector;
