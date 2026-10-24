import { useEffect, useState } from "react";
import { BookOpen, FileText, PlugZap, Puzzle } from "lucide-react";
import { DatabricksAuthCard, useDatabricksAuth } from "../components/DatabricksAuth";
import type { WorkspaceSnapshot } from "../state/workspace-types";
import type { PluginCheck, PluginsSummary } from "../api/plugins-api";
import {
    readJson,
    type DataSourcesFacts,
    type DataSourcesResponse,
    type PluginCheckResponse,
} from "../api/wire";
import { Header } from "../components/Header";

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

export function SettingsPage({
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

                    <section className="panel settings-card" style={{ borderLeft: "3px solid #ff5e57" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h3 style={{ margin: 0 }}>Architecture Dossier & Design Defense</h3>
                            <span className="badge badge-primary" style={{ fontSize: 10 }}>Staff Interview Dossier</span>
                        </div>
                        <p style={{ marginTop: 6, marginBottom: 12 }}>
                            Technical brief covering the 4 hardest trade-offs, safe read-only SQL engine, skeptical auditor calibration, and runtime post-mortems.
                        </p>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <a
                                href="/api/dossier"
                                target="_blank"
                                rel="noreferrer"
                                className="button-secondary"
                                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
                            >
                                <BookOpen size={13} /> Architecture Dossier
                            </a>
                            <a
                                href="/api/report?format=html"
                                target="_blank"
                                rel="noreferrer"
                                className="button-secondary"
                                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
                            >
                                <FileText size={13} /> Executive Intelligence Report
                            </a>
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
