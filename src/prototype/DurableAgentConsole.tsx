// Stillwork: Durable Agent Data Platform (Pi Durable Workspace Console)
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import type {
    DataSource,
    Run,
    TranscriptItem,
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
    Plus,
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
];

const navItems = [
    { href: "/prototype", label: "Overview", icon: Gauge },
    { href: "/prototype/agents", label: "Agent", icon: Bot },
    { href: "/prototype/runs", label: "Durable runs", icon: Workflow },
    { href: "/prototype/data", label: "Data health", icon: Database },
];

const agentById = (id: string, agents: WorkspaceAgent[]) => agents.find((agent) => agent.id === id);
const statusClass = (s: string) => `status-pill status-${s.toLowerCase()}`;

/** `response.json()` in Safari throws "The string did not match the expected pattern." for a non-JSON body. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!snippet) throw new Error(`Empty response from the console (${response.status}).`);
    try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`The console returned an unexpected response (${response.status}).`);
        }
        return parsed as Record<string, unknown>;
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("The console returned")) throw err;
        if (snippet.startsWith("<")) {
            throw new Error(`The console returned an unexpected response (${response.status}).`);
        }
        throw new Error(snippet);
    }
}

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

    const refresh = async () => {
        try {
            const response = await fetch("/api/workspace");
            const body = await readJson(response) as WorkspaceSnapshot & { error?: string };
            if (!response.ok) throw new Error(body.error ?? `Workspace unavailable (${response.status})`);
            setSnapshot(body);
            setLoadError("");
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };

    useEffect(() => {
        void refresh();
    }, [auth.status?.connected, auth.status?.host]);

    useEffect(() => {
        const timer = window.setInterval(() => void refresh(), snapshot?.agent.working ? 1000 : 2500);
        return () => window.clearInterval(timer);
    }, [snapshot?.agent.working]);

    const notify = (message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(""), 3200);
    };

    const askingRef = useRef(false);
    const stopDuringAsk = useRef(false);
    const [stopping, setStopping] = useState(false);

    const postAbort = async () => {
        const response = await fetch("/api/agent/abort", { method: "POST" });
        const body = await readJson(response);
        if (!response.ok || body.ok === false) {
            throw new Error(typeof body.error === "string" ? body.error : "Could not stop the turn.");
        }
        if (body.workspace && typeof body.workspace === "object") {
            setSnapshot(body.workspace as WorkspaceSnapshot);
        }
    };

    const ask = async (goal: string) => {
        stopDuringAsk.current = false;
        askingRef.current = true;
        setAsking(true);
        setLaunchOpen(false);
        try {
            const response = await fetch("/api/agent/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: goal }),
            });
            const body = await readJson(response);
            if (!response.ok || !body.ok) {
                throw new Error(typeof body.error === "string" ? body.error : "DataClaw could not start that turn.");
            }
            if (stopDuringAsk.current) await postAbort();
            else notify("DataClaw picked up the turn. It is checkpointed in SQLite.");
            setLocation("/prototype/agents");
            await refresh();
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
        if (run) await ask(run.goal);
    };

    const agents = snapshot ? [snapshot.agent] : [];
    const runs = snapshot?.runs ?? [];
    const sources = snapshot?.sources ?? [];
    const agent = snapshot?.agent;

    return (
        <div className="app-shell">
            {/* Sidebar */}
            <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
                <div className="brand">
                    <div className="brand-mark">
                        <Layers3 size={19} />
                    </div>
                    <div>
                        <div className="brand-name">Stillwork</div>
                        <div className="brand-caption">DURABLE WORKSPACE</div>
                    </div>
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
                        className={`nav-link ${location === "/prototype/settings" ? "active" : ""}`}
                    >
                        <Settings2 size={16} />
                        <span>Settings</span>
                    </Link>

                    <div className="profile">
                        <span className="profile-avatar">DC</span>
                        <span className="profile-info">
                            <b>DataClaw</b>
                            <span>{agent?.model ?? "Main agent"}</span>
                        </span>
                        <MoreHorizontal size={17} />
                    </div>
                </div>
            </aside>

            {/* Main Area */}
            <main className="main-area">
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
                            onClick={() => notify(agent?.working ? "DataClaw is still working on the current turn." : "DataClaw is ready. No turn is in flight.")}
                        >
                            <Bell size={15} />
                        </button>
                    </div>
                </header>

                {loadError && <div className="workspace-banner">{loadError}</div>}
                {snapshot?.agent.model.startsWith("faux") && (
                    <div className="workspace-banner">
                        DataClaw is on the offline model ({snapshot.agent.model}). Set the model in .pi/settings.json, or set OPENCODE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.
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
                            transcript={snapshot?.transcript ?? []}
                            skills={snapshot?.home.skills ?? []}
                            workspacePath={snapshot?.home.path}
                            working={Boolean(agent?.working) || asking}
                            stopping={stopping}
                            onStop={() => void stopAgent()}
                            ask={ask}
                            ops={ops}
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
                    <Route path="/prototype/settings">
                        <SettingsPage
                            snapshot={snapshot}
                            ops={ops}
                            setOps={setOps}
                            auth={auth}
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
    const attention = sources.filter((source) => source.status === "Warning").length;
    const today = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
    }).toUpperCase();
    const goal = snapshot?.plan.goal;
    const subtitle = !snapshot
        ? "Opening the durable agent…"
        : goal && goal !== "Pending goal definition"
            ? goal
            : "Ask DataClaw to explore a local file or the Databricks workspace. Each turn is stored in SQLite.";
    const activity = snapshot?.activity ?? [];

    return (
        <div className="page-wrap">
            <Header
                eyebrow={`${today} · DATA CLAW`}
                title={snapshot?.agent.working ? "DataClaw is working." : "DataClaw is ready."}
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
                    label="Main agent"
                    value="1"
                    foot={snapshot?.agent.working ? "<b>Working</b> on the current turn" : "<b>Ready</b> to explore data"}
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
                                <span>Start a task and DataClaw will explore from here.</span>
                            </div>
                        ) : (
                            runs.slice(0, 4).map((run) => (
                                <RunRow key={run.id} run={run} agents={agents} onClick={() => inspect(run.id)} />
                            ))
                        )}
                    </Panel>

                    <Panel
                        title={ops ? "Connected sources" : "Your data"}
                        note={ops ? "Live Databricks catalogs, local files, and durable documents." : "What DataClaw can read right now."}
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

                    <Panel title="A good place to start" note="These go straight to DataClaw.">
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
                                    aria-label="Ask DataClaw"
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

function AgentsPage({
    agents,
    transcript,
    skills,
    workspacePath,
    working,
    stopping,
    onStop,
    ask,
    ops,
}: {
    agents: WorkspaceAgent[];
    transcript: TranscriptItem[];
    skills: WorkspaceSkillInfo[];
    workspacePath?: string | undefined;
    working: boolean;
    stopping: boolean;
    onStop: () => void;
    ask: (goal: string) => void;
    ops: boolean;
}) {
    const [draft, setDraft] = useState("");
    const [showContext, setShowContext] = useState(false);
    const agent = agents[0];
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const turns = useMemo(() => groupIntoTurns(transcript), [transcript]);
    const lastIsUser = transcript[transcript.length - 1]?.role === "user";

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [transcript.length, working]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    }, [draft]);

    const submit = (text = draft) => {
        const goal = text.trim();
        if (!goal || working || stopping) return;
        setDraft("");
        ask(goal);
    };

    return (
        <div className="chat-page">
            <header className="chat-header">
                <span className="agent-icon">
                    <BrainCircuit size={17} />
                </span>
                <div className="chat-header-copy">
                    <div className="agent-title">{agent?.name ?? "DataClaw"}</div>
                    <div className="agent-owner">
                        {agent ? `${agent.sources.join(" · ")}${ops ? ` · ${agent.model}` : ""}` : "Opening…"}
                    </div>
                </div>
                <span className={working ? "status-pill status-running" : "status-pill status-idle"}>
                    {working ? "Working" : agent?.status ?? "Opening"}
                </span>
                <button
                    className="button-quiet"
                    onClick={() => setShowContext(!showContext)}
                    aria-expanded={showContext}
                >
                    Context <ChevronDown size={13} className={showContext ? "chat-chevron open" : "chat-chevron"} />
                </button>
            </header>

            {showContext && (
                <div className="chat-context">
                    {agent && <p>{agent.description}</p>}
                    <div className="panel-note">{workspacePath ?? "Opening workspace…"} · AGENTS.md loads every turn</div>
                    {skills.length > 0 && (
                        <div className="data-chips" style={{ marginTop: 10 }}>
                            {skills.map((skill) => (
                                <span className="chip" key={skill.location} title={skill.description}>
                                    {skill.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="chat-scroll">
                <div className="chat-thread">
                    {transcript.length === 0 ? (
                        <div className="chat-empty">
                            <Sparkles size={22} />
                            <h2>What should DataClaw look at?</h2>
                            <p>Ask about a catalog, a table, or a local file.</p>
                            <div className="chat-starters">
                                {STARTERS.map((prompt) => (
                                    <button key={prompt} onClick={() => submit(prompt)} disabled={working}>
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        turns.map((turn, i) => {
                            const isLast = i === turns.length - 1;
                            if (turn.role === "user") {
                                return (
                                    <div className="chat-msg chat-user" key={turn.id}>
                                        <div className="chat-bubble">
                                            <div className="chat-user-text">{turn.userText}</div>
                                        </div>
                                        <time>{turn.time}</time>
                                    </div>
                                );
                            }
                            return (
                                <AssistantTurnView
                                    key={turn.id}
                                    turn={turn}
                                    live={working && isLast}
                                />
                            );
                        })
                    )}
                    {working && lastIsUser && (
                        <div className="chat-msg chat-assistant">
                            <span className="chat-avatar">
                                <BrainCircuit size={13} />
                            </span>
                            <div className="chat-assistant-body">
                                <div className="chat-typing-inline" aria-label="DataClaw is thinking">
                                    <span>Thinking…</span>
                                    <div className="chat-typing">
                                        <i /><i /><i />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>
            </div>

            <div className="chat-composer-wrap">
                <div className="chat-composer">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Ask DataClaw…"
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                    />
                    {working || stopping ? (
                        <button
                            className="chat-send stop"
                            type="button"
                            onClick={onStop}
                            disabled={stopping}
                            aria-label={stopping ? "Stopping" : "Stop"}
                            title={stopping ? "Stopping" : "Stop"}
                        >
                            {stopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={12} />}
                        </button>
                    ) : (
                        <button
                            className="chat-send"
                            onClick={() => submit()}
                            disabled={!draft.trim()}
                            aria-label="Send"
                        >
                            <ArrowUp size={15} />
                        </button>
                    )}
                </div>
                <div className="chat-hint">Enter to send · Shift+Enter for a new line · every turn is saved</div>
            </div>
        </div>
    );
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

function SettingsPage({
    snapshot,
    ops,
    setOps,
    auth,
    onManageDatabricks,
}: {
    snapshot: WorkspaceSnapshot | null;
    ops: boolean;
    setOps: (value: boolean) => void;
    auth: ReturnType<typeof useDatabricksAuth>;
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

                    <DatabricksAuthCard auth={auth} onManage={onManageDatabricks} />

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

function LaunchModal({
    busy,
    onClose,
    onLaunch,
}: {
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
                        <div className="eyebrow">ASK DATACLAW</div>
                        <h2>What should DataClaw explore?</h2>
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
                        <Play size={13} /> {busy ? "Sending…" : "Ask DataClaw"}
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
