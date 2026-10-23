// DataClaw: Durable Agent Data Platform (Console Shell)
//
// The console shell: navigation, the sidebar, the header, and the client-side route table. Each
// page and each reusable piece lives in `pages/` and `components/`; the HTTP seam lives in `api/`.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import type { WorkspaceSnapshot } from "./state/workspace-types";
import { DatabricksAuthModal, useDatabricksAuth } from "./components/DatabricksAuth";
import { agentInitials, rosterAsAgents } from "./components/view-model";
import {
    readJson,
    type AgentAbortResponse,
    type AgentAskResponse,
    type WorkspaceResponse,
} from "./api/wire";
import { AgentPicker } from "./components/AgentPicker";
import { AgentsPage } from "./pages/AgentsPage";
import { CapabilitiesPage } from "./pages/CapabilitiesPage";
import { DataPage } from "./pages/DataPage";
import { LaunchModal } from "./components/LaunchModal";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage } from "./pages/SettingsPage";
import {
    ArrowRight,
    Bell,
    Bot,
    Database,
    Gauge,
    Layers3,
    Menu,
    MoreHorizontal,
    Puzzle,
    Settings2,
    Workflow,
    X,
} from "lucide-react";

const navItems = [
    { href: "/console", label: "Overview", icon: Gauge },
    { href: "/console/agents", label: "Agents & Chat", icon: Bot },
    { href: "/console/runs", label: "Durable runs", icon: Workflow },
    { href: "/console/data", label: "Data health", icon: Database },
    { href: "/console/capabilities", label: "Capabilities", icon: Puzzle },
];

const agentPath = (id: string) => id === "dataclaw"
    ? "/console/agents"
    : `/console/agents?agent=${encodeURIComponent(id)}`;

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
        window.setTimeout(() => setToast(""), 2200);
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
            else notify(`Checkpointed in SQLite · ${targetName} active`);
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

    const isAgentsView = location === "/console/agents" || location.startsWith("/console/agents")
        || location === "/prototype/agents" || location.startsWith("/prototype/agents");

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
                            <div className="brand-name">DataClaw</div>
                            <div className="brand-caption">DURABLE AI & DATA</div>
                        </div>
                    </div>
                    {isAgentsView && (
                        <button
                            type="button"
                            onClick={() => setMenuOpen(false)}
                            aria-label="Close Platform Menu"
                            style={{
                                background: "rgba(255, 255, 255, 0.06)",
                                border: "1px solid rgba(255, 255, 255, 0.12)",
                                color: "#cbd5e1",
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
                        const isActive = location === item.href
                            || (item.href === "/console" && (location === "/" || location === "/prototype"));
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMenuOpen(false)}
                                className={`nav-link ${isActive ? "active" : ""}`}
                            >
                                <Icon size={16} />
                                <span>{item.label}</span>
                                {item.href === "/console/runs" && (
                                    <span className="nav-count">{runs.length}</span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="sidebar-bottom">
                    <div className="system-card">
                        <div className="system-heading">
                            <span>SQLite WAL</span>
                            <span className="live-dot" />
                        </div>
                        <p>Checkpointed & crash resilient. Active durable sessions in SQLite.</p>
                    </div>

                    <Link
                        href="/console/settings"
                        onClick={() => setMenuOpen(false)}
                        className={`nav-link ${location === "/console/settings" ? "active" : ""}`}
                    >
                        <Settings2 size={16} />
                        <span>Settings</span>
                    </Link>

                    <div className="profile">
                        <span className="profile-avatar">{agentInitials(agent?.name ?? "DataClaw")}</span>
                        <div className="profile-info">
                            <b>{agent?.name ?? "DataClaw"}</b>
                            <span>{agent?.model ?? "Coordinator"}</span>
                        </div>
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
                    <Route path="/console">
                        <Overview
                            snapshot={snapshot}
                            agents={agents}
                            runs={runs}
                            sources={sources}
                            openLaunch={() => setLaunchOpen(true)}
                            ask={ask}
                            asking={asking}
                            inspect={(id) => setLocation("/console/runs?selected=" + id)}
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
                            inspect={(id) => setLocation("/console/runs?selected=" + id)}
                            ops={ops}
                        />
                    </Route>
                    <Route path="/console/agents">
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
                            onOpenPlatformMenu={() => setMenuOpen(true)}
                            onOpenSettings={() => setLocation("/console/settings")}
                        />
                    </Route>
                    <Route path="/console/runs">
                        <RunsPage runs={runs} agents={agents} changeRun={changeRun} notify={notify} />
                    </Route>
                    <Route path="/console/data">
                        <DataPage
                            sources={sources}
                            runs={runs}
                            ops={ops}
                            onConnect={() => setAuthOpen(true)}
                            inspect={(id) => setLocation("/console/runs?selected=" + id)}
                        />
                    </Route>
                    <Route path="/console/capabilities">
                        <CapabilitiesPage
                            notify={notify}
                            onApplied={(workspace) => setSnapshot(workspace)}
                        />
                    </Route>
                    <Route path="/console/settings">
                        <SettingsPage
                            snapshot={snapshot}
                            ops={ops}
                            setOps={setOps}
                            auth={auth}
                            notify={notify}
                            onManageDatabricks={() => setAuthOpen(true)}
                        />
                    </Route>

                    {/* Legacy backward-compatibility redirects */}
                    <Route path="/prototype/:rest*">
                        {(params) => {
                            const rest = params["rest*"];
                            const target = rest ? `/console/${rest}` : "/console";
                            useEffect(() => {
                                setLocation(target);
                            }, [target]);
                            return null;
                        }}
                    </Route>
                    <Route path="/prototype">
                        {() => {
                            useEffect(() => {
                                setLocation("/console");
                            }, []);
                            return null;
                        }}
                    </Route>

                    <Route>
                        <NotFound goHome={() => setLocation("/console")} />
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
            {toast && (
                <div className="toast-local" role="status">
                    <span className="toast-pulse-dot" />
                    <span>{toast}</span>
                </div>
            )}
        </div>
    );
}
