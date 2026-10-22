// Stillwork: Durable Agent Data Platform (Pi Durable Workspace Console)
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import type {
    DataSource,
    Run,
    TranscriptItem,
    RosterEntry,
    WorkspaceAgent,
    WorkspaceSkillInfo,
    WorkspaceSnapshot,
} from "./workspace-types";
import {
    DatabricksAuthCard,
    DatabricksAuthModal,
    useDatabricksAuth,
} from "./DatabricksAuth";
import { AssistantTurnView, groupIntoTurns } from "./ChatComponents";
import type { PluginCheck, PluginsSummary } from "./plugins-api";
import {
    readJson,
    type AgentAbortResponse,
    type AgentAskResponse,
    type DataSourcesFacts,
    type DataSourcesResponse,
    type PluginCheckResponse,
    type WorkspaceResponse,
} from "./wire";
import { CapabilitiesPage } from "./CapabilitiesPage";
import { AgentsPage } from "./AgentsPage";
import {
    ArrowRight,
    Bell,
    Bot,
    BrainCircuit,
    Check,
    CheckCircle2,
    ChevronDown,
    CirclePause,
    Database,
    FileClock,
    Gauge,
    Layers3,
    LifeBuoy,
    Loader2,
    Menu,
    MoreHorizontal,
    Play,
    PlugZap,
    Plus,
    Puzzle,
    RefreshCw,
    Search,
    Settings2,
    ShieldCheck,
    Sparkles,
    Square,
    ArrowUp,
    Workflow,
    X,
} from "lucide-react";

const STARTERS = [
    "Explore the Databricks workspace: list catalogs, pick a table, and profile it.",
    "Profile sample-data/customer_churn.csv and tell me what is worth testing.",
    "Summarize the current plan, findings, and playbook.",
    "Create a researcher named churn-analyst and have them profile sample-data/customer_churn.csv.",
];

const navItems = [
    { href: "/prototype", label: "Overview", icon: Gauge },
    { href: "/prototype/agents", label: "Agent", icon: Bot },
    { href: "/prototype/runs", label: "Durable runs", icon: Workflow },
    { href: "/prototype/data", label: "Data health", icon: Database },
    { href: "/prototype/capabilities", label: "Capabilities", icon: Puzzle },
];

const agentById = (id: string, agents: WorkspaceAgent[]) => agents.find((agent) => agent.id === id);
const statusClass = (s: string) => `status-pill status-${s.toLowerCase()}`;
const agentPath = (id: string) => id === "dataclaw"
    ? "/prototype/agents"
    : `/prototype/agents?agent=${encodeURIComponent(id)}`;
const agentInitials = (name: string) => name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "DC";

export function DurableAgentConsole() {
    const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
    const [loadError, setLoadError] = useState("");
    const [asking, setAsking] = useState(false);
    const [ops, setOps] = useState(false);
    const [launchOpen, setLaunchOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const auth = useDatabricksAuth();
    const [toast, setToast] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const [location, setLocation] = useLocation();
    const [selectedAgentId, setSelectedAgentId] = useState<string>(() => {
        if (typeof window === "undefined") return "dataclaw";
        const fromUrl = new URLSearchParams(window.location.search).get("agent");
        return fromUrl || window.localStorage.getItem("dataclaw.activeAgent") || "dataclaw";
    });

    // A stale picker (archived agent, deleted roster entry) falls back to DataClaw without
    // rewriting the stored choice, so restoring the agent brings the selection back.
    const activeAgentId = useMemo(() => {
        if (!selectedAgentId || selectedAgentId === "dataclaw") return "dataclaw";
        // Before the first snapshot, trust the URL/localStorage choice; the backend validates it.
        if (!snapshot) return selectedAgentId;
        const active = (snapshot.roster ?? []).some((entry) => entry.id === selectedAgentId && entry.status === "active");
        return active ? selectedAgentId : "dataclaw";
    }, [selectedAgentId, snapshot]);

    const selectAgent = (id: string) => {
        const next = !id || id === "dataclaw" ? "dataclaw" : id;
        setSelectedAgentId(next);
        if (typeof window !== "undefined") window.localStorage.setItem("dataclaw.activeAgent", next);
        setLocation(agentPath(next));
        void refresh(next);
    };

    const refresh = async (agentId: string = activeAgentId) => {
        try {
            const url = agentId && agentId !== "dataclaw"
                ? `/api/workspace?agentId=${encodeURIComponent(agentId)}`
                : "/api/workspace";
            const response = await fetch(url);
            const body = await readJson<WorkspaceResponse>(response);
            if (!response.ok || body.ok === false) {
                throw new Error(body.ok === false ? body.error : `Workspace unavailable (${response.status})`);
            }
            setSnapshot(body);
            setLoadError("");
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };

    useEffect(() => {
        void refresh();
    }, [auth.status?.connected, auth.status?.host, activeAgentId]);

    useEffect(() => {
        const timer = window.setInterval(() => void refresh(), snapshot?.agent.working ? 1000 : 2500);
        return () => window.clearInterval(timer);
    }, [snapshot?.agent.working, activeAgentId]);

    const notify = (message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(""), 3200);
    };

    const askingRef = useRef(false);
    const stopDuringAsk = useRef(false);
    const [stopping, setStopping] = useState(false);

    const postAbort = async () => {
        const response = await fetch("/api/agent/abort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: activeAgentId === "dataclaw" ? undefined : activeAgentId }),
        });
        const body = await readJson<AgentAbortResponse>(response);
        if (!response.ok || body.ok === false) {
            throw new Error(body.ok === false ? body.error : "Could not stop the turn.");
        }
        setSnapshot(body.workspace);
    };

    const ask = async (goal: string, agentIdOverride?: string) => {
        const targetAgentId = agentIdOverride ?? activeAgentId;
        const targetName = targetAgentId === "dataclaw"
            ? "DataClaw"
            : snapshot?.roster.find((entry) => entry.id === targetAgentId)?.name ?? "the agent";
        if (targetAgentId !== activeAgentId) {
            setSelectedAgentId(targetAgentId);
            if (typeof window !== "undefined") window.localStorage.setItem("dataclaw.activeAgent", targetAgentId);
        }
        stopDuringAsk.current = false;
        askingRef.current = true;
        setAsking(true);
        setLaunchOpen(false);
        try {
            const response = await fetch("/api/agent/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: goal,
                    agentId: targetAgentId === "dataclaw" ? undefined : targetAgentId,
                }),
            });
            const body = await readJson<AgentAskResponse>(response);
            if (!response.ok || body.ok === false) {
                throw new Error(body.ok === false ? body.error : `${targetName} could not start that turn.`);
            }
            if (stopDuringAsk.current) await postAbort();
            else notify(`${targetName} picked up the turn. It is checkpointed in SQLite.`);
            setLocation(agentPath(targetAgentId));
            await refresh(targetAgentId);
        } catch (err) {
            notify(err instanceof Error ? err.message : String(err));
        } finally {
            askingRef.current = false;
            setAsking(false);
        }
    };

    const stopAgent = async () => {
        if (stopping) return;
        if (askingRef.current) stopDuringAsk.current = true;
        setStopping(true);
        try {
            await postAbort();
            notify("Stopped. Finished work stays in SQLite.");
            await refresh();
        } catch (err) {
            notify(err instanceof Error ? err.message : String(err));
        } finally {
            setStopping(false);
        }
    };

    const changeRun = async (id: string, action: "stop" | "retry") => {
        if (action === "stop") {
            await stopAgent();
            return;
        }
        const run = runs.find((item) => item.id === id);
        if (run) await ask(run.goal, run.agentId);
    };

    const agents = snapshot
        ? [snapshot.agent, ...rosterAsAgents(snapshot.roster, snapshot.agent.model).filter((item) => item.id !== snapshot.agent.id)]
        : [];
    const runs = snapshot?.runs ?? [];
    const sources = snapshot?.sources ?? [];
    const agent = snapshot?.agent;

    const isAgentsView = location === "/prototype/agents" || location.startsWith("/prototype/agents");

    return (
        <div
            className="app-shell"
            style={isAgentsView ? { height: "100dvh", minHeight: "100dvh", overflow: "hidden" } : undefined}
        >
            {/* Backdrop for Stillwork slide-over drawer when on Agents view */}
            {isAgentsView && menuOpen && (
                <div
                    role="button"
                    tabIndex={0}
                    aria-label="Close navigation"
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(18, 46, 42, 0.55)",
                        backdropFilter: "blur(4px)",
                        zIndex: 9998,
                        animation: "fade 0.16s ease",
                    }}
                    onClick={() => setMenuOpen(false)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") setMenuOpen(false);
                    }}
                />
            )}

            {/* Sidebar (Stillwork greenish console menu) */}
            <aside
                className={`sidebar ${menuOpen ? "open" : ""}`}
                style={
                    isAgentsView
                        ? {
                              transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
                              transition: "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
                              boxShadow: menuOpen ? "0 24px 60px rgba(10, 30, 26, 0.5)" : "none",
                              zIndex: 9999,
                          }
                        : undefined
                }
            >
                <div className="brand" style={{ justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <div className="brand-mark">
                            <Layers3 size={19} />
                        </div>
                        <div>
                            <div className="brand-name">Stillwork</div>
                            <div className="brand-caption">DURABLE WORKSPACE</div>
                        </div>
                    </div>
                    {isAgentsView && (
                        <button
                            type="button"
                            onClick={() => setMenuOpen(false)}
                            aria-label="Close Stillwork Menu"
                            style={{
                                background: "transparent",
                                border: "1px solid #35514e",
                                color: "#b5c3bd",
                                borderRadius: 7,
                                width: 28,
                                height: 28,
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                            }}
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>

                <div className="agent-picker-wrap">
                    <div className="agent-picker-label">ACTIVE AGENT</div>
                    <AgentPicker
                        roster={snapshot?.roster ?? []}
                        value={activeAgentId}
                        onChange={selectAgent}
                    />
                </div>

                <nav className="nav-group">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location === item.href || (item.href === "/prototype" && location === "/");
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMenuOpen(false)}
                                className={`nav-link ${isActive ? "active" : ""}`}
                            >
                                <Icon size={16} />
                                <span>{item.label}</span>
                                {item.href === "/prototype/runs" && (
                                    <span className="nav-count">{runs.length}</span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="sidebar-bottom">
                    <Link
                        href="/prototype/settings"
                        onClick={() => setMenuOpen(false)}
                        className={`nav-link ${location === "/prototype/settings" ? "active" : ""}`}
                    >
                        <Settings2 size={16} />
                        <span>Settings</span>
                    </Link>

                    <div className="profile">
                        <span className="profile-avatar">{agentInitials(agent?.name ?? "DataClaw")}</span>
                        <span className="profile-info">
                            <b>{agent?.name ?? "DataClaw"}</b>
                            <span>{agent?.model ?? "Main agent"}</span>
                        </span>
                        <MoreHorizontal size={17} />
                    </div>
                </div>
            </aside>

            {/* Main Area */}
            <main
                className="main-area"
                style={
                    isAgentsView
                        ? {
                              marginLeft: 0,
                              height: "100dvh",
                              minHeight: "100dvh",
                              overflow: "hidden",
                              background: "transparent",
                          }
                        : undefined
                }
            >
                {!isAgentsView && (
                    <header className="topbar">
                        <button
                            className="icon-button mobile-menu"
                            aria-label="Open navigation"
                            onClick={() => setMenuOpen(!menuOpen)}
                        >
                            {menuOpen ? <X size={16} /> : <Menu size={16} />}
                        </button>
                        <div className="crumb">
                            <span>DataClaw Studio</span>
                            <ArrowRight size={12} />
                            <strong>
                                {navItems.find((i) => i.href === location)?.label ??
                                    (location.includes("settings") ? "Settings" : "Overview")}
                            </strong>
                        </div>

                        <div className="top-actions">
                            <button
                                className="context-switch"
                                onClick={() => setAuthOpen(true)}
                                title={auth.status?.connected ? `Databricks connected: ${auth.status.host}` : "Connect Databricks via MCP"}
                            >
                                <Database size={14} />
                                <span>
                                    {auth.status?.connected
                                        ? "Databricks connected"
                                        : auth.loading
                                            ? "Checking Databricks…"
                                            : "Connect Databricks"}
                                </span>
                                <i className={`live-dot ${auth.status?.connected ? "" : "dbx-dot-off"}`} />
                            </button>

                            <button
                                className="icon-button"
                                aria-label="Notifications"
                                onClick={() => notify(agent?.working ? `${agent?.name ?? "DataClaw"} is still working on the current turn.` : `${agent?.name ?? "DataClaw"} is ready. No turn is in flight.`)}
                            >
                                <Bell size={15} />
                            </button>
                        </div>
                    </header>
                )}

                {loadError && <div className="workspace-banner">{loadError}</div>}
                {snapshot?.agent.model.startsWith("faux") && !isAgentsView && (
                    <div className="workspace-banner">
                        {snapshot.agent.name} is on the offline model ({snapshot.agent.model}). Set the model in .pi/settings.json, or set OPENCODE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.
                    </div>
                )}

                <Switch>
                    <Route path="/prototype">
                        <Overview
                            snapshot={snapshot}
                            agents={agents}
                            runs={runs}
                            sources={sources}
                            openLaunch={() => setLaunchOpen(true)}
                            ask={ask}
                            asking={asking}
                            inspect={(id) => setLocation("/prototype/runs?selected=" + id)}
                            ops={ops}
                        />
                    </Route>
                    <Route path="/">
                        <Overview
                            snapshot={snapshot}
                            agents={agents}
                            runs={runs}
                            sources={sources}
                            openLaunch={() => setLaunchOpen(true)}
                            ask={ask}
                            asking={asking}
                            inspect={(id) => setLocation("/prototype/runs?selected=" + id)}
                            ops={ops}
                        />
                    </Route>
                    <Route path="/prototype/agents">
                        <AgentsPage
                            agents={agents}
                            roster={snapshot?.roster ?? []}
                            activeAgentId={activeAgentId}
                            onSelectAgent={selectAgent}
                            transcript={snapshot?.transcript ?? []}
                            skills={snapshot?.home.skills ?? []}
                            workspacePath={snapshot?.home.path}
                            working={Boolean(agent?.working) || asking}
                            stopping={stopping}
                            onStop={() => void stopAgent()}
                            ask={ask}
                            ops={ops}
                            onToggleOps={() => setOps(!ops)}
                            onOpenStillworkMenu={() => setMenuOpen(true)}
                            onOpenSettings={() => setLocation("/prototype/settings")}
                        />
                    </Route>
                    <Route path="/prototype/runs">
                        <RunsPage runs={runs} agents={agents} changeRun={changeRun} notify={notify} />
                    </Route>
                    <Route path="/prototype/data">
                        <DataPage
                            sources={sources}
                            runs={runs}
                            ops={ops}
                            onConnect={() => setAuthOpen(true)}
                            inspect={(id) => setLocation("/prototype/runs?selected=" + id)}
                        />
                    </Route>
                    <Route path="/prototype/capabilities">
                        <CapabilitiesPage
                            notify={notify}
                            onApplied={(workspace) => setSnapshot(workspace)}
                        />
                    </Route>
                    <Route path="/prototype/settings">
                        <SettingsPage
                            snapshot={snapshot}
                            ops={ops}
                            setOps={setOps}
                            auth={auth}
                            notify={notify}
                            onManageDatabricks={() => setAuthOpen(true)}
                        />
                    </Route>
                    <Route>
                        <NotFound goHome={() => setLocation("/prototype")} />
                    </Route>
                </Switch>
            </main>

            {launchOpen && (
                <LaunchModal
                    agentName={snapshot?.agent.name ?? "DataClaw"}
                    busy={asking}
                    onClose={() => setLaunchOpen(false)}
                    onLaunch={(goal) => void ask(goal)}
                />
            )}

            {/* Databricks auth / connection */}
            <DatabricksAuthModal
                open={authOpen}
                auth={auth}
                onClose={() => setAuthOpen(false)}
                notify={notify}
            />

            {/* Toast */}
            {toast && <div className="toast-local" role="status">{toast}</div>}
        </div>
    );
}

function Header({
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

function Panel({
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

function Metric({
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

function RunRow({ run, agents, onClick }: { run: Run; agents: WorkspaceAgent[]; onClick: () => void }) {
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

function Overview({
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

function AgentPicker({
    roster,
    value,
    onChange,
    variant = "sidebar",
}: {
    roster: RosterEntry[];
    value: string;
    onChange: (id: string) => void;
    variant?: "sidebar" | "chat";
}) {
    const active = (roster ?? []).filter((entry) => entry.status === "active");
    return (
        <>
            <select
                className={`agent-picker ${variant === "chat" ? "agent-picker-chat" : ""}`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label="Active agent"
                title="Switch agent"
            >
                <option value="dataclaw">DataClaw · coordinator</option>
                {active.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                        {entry.name} · {entry.role} · {entry.compute}
                    </option>
                ))}
            </select>
            {variant === "sidebar" && active.length === 0 && (
                <div className="agent-picker-hint">No specialists yet · ask DataClaw to create one</div>
            )}
        </>
    );
}

function rosterAsAgents(roster: RosterEntry[] | undefined, model: string): WorkspaceAgent[] {
    return (roster ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.purpose,
        status: entry.working ? "Working" : "Ready",
        working: entry.working,
        model: entry.model ?? model,
        sources: [
            entry.status === "archived" ? `${entry.role} · archived` : entry.role,
            `compute: ${entry.compute}`,
        ],
    }));
}

function RunsPage({
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

function DataPage({
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
                                        style={{
                                            background: source?.id === s.id ? "#f2f5ec" : undefined,
                                        }}
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

function DataSourcesCard({ agentId }: { agentId: string }) {
    const [summary, setSummary] = useState<DataSourcesFacts | null>(null);

    useEffect(() => {
        let live = true;
        fetch(`/api/datasources?agentId=${encodeURIComponent(agentId)}`)
            .then((response) => readJson<DataSourcesResponse>(response))
            .then((body) => { if (live && body.ok !== false) setSummary(body); })
            .catch(() => undefined);
        return () => { live = false; };
    }, [agentId]);

    const status = summary?.status;
    const detail = status?.state === "live"
        ? [status.record?.host, status.record?.dataset].filter(Boolean).join(" · ") || "Connected"
        : status?.state === "failed"
            ? status.error?.message ?? "Connect failed"
            : "Not connected";

    return (
        <section className="panel settings-card">
            <h3>Data sources</h3>
            <p>One live source per conversation. The agent reaches it with query_data, discover_data, and profile_table.</p>
            <div className="form-row">
                <div>
                    <label>{status?.state === "live" ? status.record?.provider ?? "Live" : status?.state ?? "Loading…"}</label>
                    <small>{detail}</small>
                </div>
            </div>
            <div className="data-chips">
                {(summary?.providers ?? []).map((provider) => (
                    <span className="chip" key={provider.id} title={provider.label}>
                        {provider.id} · {provider.kind}
                    </span>
                ))}
            </div>
        </section>
    );
}

function SettingsPage({
    snapshot,
    ops,
    setOps,
    auth,
    notify,
    onManageDatabricks,
}: {
    snapshot: WorkspaceSnapshot | null;
    ops: boolean;
    setOps: (value: boolean) => void;
    auth: ReturnType<typeof useDatabricksAuth>;
    notify: (message: string) => void;
    onManageDatabricks: () => void;
}) {
    return (
        <div className="page-wrap">
            <Header
                eyebrow="WORKSPACE"
                title="Settings"
                subtitle="The model, storage, and Databricks session behind DataClaw."
            />

            <div className="settings-layout">
                <div className="panel settings-nav">
                    <button className="active">Workspace</button>
                    <button onClick={onManageDatabricks}>Databricks</button>
                </div>

                <div>
                    <section className="panel settings-card">
                        <h3>Main agent</h3>
                        <p>One root conversation. Instructions, plan, findings, and playbook are reloaded from SQLite on startup.</p>
                        <div className="form-row">
                            <div>
                                <label>Model</label>
                                <small>{snapshot?.agent.model ?? "Opening the harness…"}</small>
                            </div>
                            <span className="chip">{snapshot?.agent.status ?? "…"}</span>
                        </div>
                        <div className="form-row">
                            <div>
                                <label>Presentation context</label>
                                <small>Show model ids, milestones, and hypothesis counts.</small>
                            </div>
                            <button
                                className={`toggle ${ops ? "on" : ""}`}
                                onClick={() => setOps(!ops)}
                                aria-label="Toggle data operations context"
                            >
                                <i />
                            </button>
                        </div>
                    </section>

                    <DataSourcesCard agentId={snapshot?.agent.id ?? "dataclaw"} />

                    <DatabricksAuthCard auth={auth} onManage={onManageDatabricks} />

                    <PluginsCard plugins={snapshot?.plugins} notify={notify} />

                    <section className="panel settings-card">
                        <h3>Workspace</h3>
                        <p>AGENTS.md, SOUL.md, IDENTITY.md, and USER.md load every turn. Skills stay listed until DataClaw reads the SKILL.md.</p>
                        <div className="form-row">
                            <div>
                                <label>{snapshot?.home.path ?? "Opening workspace…"}</label>
                                <small>
                                    {snapshot?.home.skills.length ?? 0} skills · workspace skills override project and personal skills of the same name
                                </small>
                            </div>
                        </div>
                        <div className="data-chips">
                            {(snapshot?.home.skills ?? []).map((skill) => (
                                <span className="chip" key={skill.location} title={`${skill.source}: ${skill.location}`}>
                                    {skill.name}
                                </span>
                            ))}
                        </div>
                    </section>

                    <section className="panel settings-card">
                        <h3>Durable storage</h3>
                        <p>Plans, findings, the playbook, and the transcript live in this SQLite file.</p>
                        <div className="form-row">
                            <div>
                                <label>{snapshot?.storagePath ?? "Opening storage…"}</label>
                                <small>
                                    Playbook v{snapshot?.playbookVersion ?? "—"} · {snapshot?.heuristicCount ?? 0} heuristics · {snapshot?.findingsCount ?? 0} findings
                                </small>
                            </div>
                            <span className="chip">{snapshot?.plan.milestone ?? "Intake"}</span>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

function PluginsCard({
    plugins,
    notify,
}: {
    plugins?: PluginsSummary;
    notify: (message: string) => void;
}) {
    const [checking, setChecking] = useState(false);
    const [checks, setChecks] = useState<PluginCheck[] | undefined>();
    const installed = plugins?.plugins ?? [];

    const runCheck = async () => {
        setChecking(true);
        try {
            const response = await fetch("/api/plugins/check", { method: "POST" });
            const body = await readJson<PluginCheckResponse>(response);
            if (!response.ok || body.ok === false) throw new Error(body.ok === false ? body.error : "The plugin check failed.");
            const results = body.checks;
            setChecks(results);
            const failed = results.filter((check) => !check.ok);
            notify(failed.length
                ? `${failed.length} plugin${failed.length === 1 ? "" : "s"} failed: ${failed.map((check) => check.name).join(", ")}`
                : `${results.length} plugin${results.length === 1 ? "" : "s"} answered`);
        } catch (err) {
            notify(err instanceof Error ? err.message : String(err));
        } finally {
            setChecking(false);
        }
    };

    return (
        <section className="panel settings-card">
            <h3>Data plugins</h3>
            <p>
                External programs that answer named capabilities over MCP and hand their tools to
                DataClaw as <span className="mono">&lt;plugin&gt;__&lt;tool&gt;</span>, loaded through tool_search.
            </p>

            {installed.length === 0 ? (
                <div className="empty-state" style={{ padding: "22px 10px" }}>
                    <Puzzle size={22} />
                    <b>No plugins installed</b>
                    <span>Drop a manifest in {plugins?.searchPaths.join(", ") ?? "plugins/<name>/plugin.json"}.</span>
                </div>
            ) : (
                installed.map((plugin) => {
                    const check = checks?.find((result) => result.name === plugin.name);
                    return (
                        <div className="form-row" key={plugin.name} style={{ alignItems: "flex-start" }}>
                            <div style={{ minWidth: 0 }}>
                                <label>{plugin.name} {plugin.version}</label>
                                <small>{plugin.description}</small>
                                <div className="data-chips" style={{ marginTop: 8 }}>
                                    <span className="chip" title={`${plugin.transport} transport · priority ${plugin.priority}`}>
                                        {plugin.domain} · {plugin.transport}
                                    </span>
                                    {plugin.capabilities.map((capability) => (
                                        <span
                                            className="chip"
                                            key={capability.id}
                                            title={capability.winner
                                                ? "this plugin serves it"
                                                : `shadowed by ${capability.shadowedBy ?? "another plugin"}`}
                                            style={capability.winner ? undefined : { opacity: 0.55, textDecoration: "line-through" }}
                                        >
                                            {capability.id}
                                        </span>
                                    ))}
                                    {plugin.tools.map((tool) => (
                                        <span className="chip" key={tool.name} title={`agent tool ${tool.name} · MCP tool ${tool.tool}`}>
                                            {tool.tool}
                                        </span>
                                    ))}
                                </div>
                                <small style={{ marginTop: 6 }}>
                                    {plugin.status === "capabilities-only"
                                        ? "capabilities only"
                                        : plugin.status === "ready"
                                        ? `${plugin.tools.length} agent tool${plugin.tools.length === 1 ? "" : "s"}${
                                            plugins?.deferred ? " · deferred behind tool_search" : ""
                                        }`
                                        : plugin.error ?? "manifest only"}
                                    {check && (
                                        <> · {check.capabilitiesOnly
                                            ? "capabilities only"
                                            : check.ok ? `answered: ${check.tools?.join(", ") || "no tools"}` : `failed: ${check.error}`}</>
                                    )}
                                </small>
                            </div>
                        </div>
                    );
                })
            )}

            {(plugins?.errors.length ?? 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                    {plugins?.errors.map((error) => (
                        <small key={error} style={{ display: "block", color: "#b15449" }}>{error}</small>
                    ))}
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 14 }}>
                <small>Check starts each MCP plugin once, like <span className="mono">plugins:list --check</span>.</small>
                <button className="button-secondary" onClick={() => void runCheck()} disabled={checking || installed.length === 0}>
                    <PlugZap size={13} /> {checking ? "Checking…" : "Check"}
                </button>
            </div>
        </section>
    );
}

function LaunchModal({
    agentName,
    busy,
    onClose,
    onLaunch,
}: {
    agentName: string;
    busy: boolean;
    onClose: () => void;
    onLaunch: (goal: string) => void;
}) {
    const [goal, setGoal] = useState("");
    const [error, setError] = useState("");

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
            <div className="modal" role="dialog" aria-modal="true">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <div className="eyebrow">ASK {agentName.toUpperCase()}</div>
                        <h2>What should {agentName} explore?</h2>
                        <p>The turn is admitted to the durable conversation and can resume after a restart.</p>
                    </div>
                    <button className="icon-button" onClick={onClose} aria-label="Close">
                        <X size={15} />
                    </button>
                </div>

                <label htmlFor="task-goal">Task</label>
                <textarea
                    id="task-goal"
                    value={goal}
                    onChange={(event) => {
                        setGoal(event.target.value);
                        setError("");
                    }}
                    placeholder="For example: list Unity Catalog schemas in samples and profile one table."
                />
                {error && <div style={{ color: "#b15449", fontSize: 10, marginTop: 6 }}>{error}</div>}

                <div className="modal-footer">
                    <button className="button-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="button-primary"
                        disabled={busy}
                        onClick={() => (goal.trim() ? onLaunch(goal.trim()) : setError("Add a task to continue."))}
                    >
                        <Play size={13} /> {busy ? "Sending…" : `Ask ${agentName}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

function NotFound({ goHome }: { goHome: () => void }) {
    return (
        <div className="page-wrap">
            <div className="panel empty-state" style={{ marginTop: 50 }}>
                <LifeBuoy size={25} />
                <b>This page is not in the workspace</b>
                <span>Head back to your overview to pick up where you left off.</span>
                <button
                    className="button-primary"
                    style={{ margin: "16px auto 0" }}
                    onClick={goHome}
                >
                    Return to overview
                </button>
            </div>
        </div>
    );
}
