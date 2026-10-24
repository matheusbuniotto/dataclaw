// Capabilities page: plug in, switch off, and apply — skills, plugins/MCP tools, built-in tools.
import React, { useEffect, useMemo, useState } from "react";
import {
    Bot,
    Check,
    Loader2,
    Package,
    Plus,
    Puzzle,
    RefreshCw,
    Trash2,
    Wrench,
} from "lucide-react";
import type { CapabilityCatalog, CapabilityEntry, CapabilityKind } from "../../capabilities/catalog";
import {
    readJson,
    type ApplyCapabilitiesResponse,
    type CapabilityChange,
    type CapabilityChangeResponse,
    type CapabilitiesResponse,
} from "../api/wire";
import type { WorkspaceSnapshot } from "../state/workspace-types";

const KIND_LABEL: Record<CapabilityKind, string> = {
    tools: "Built-in tool",
    plugin: "Plugin",
    skill: "Skill",
    mcp: "MCP connection",
};

const KIND_ICON: Record<CapabilityKind, React.ReactNode> = {
    tools: <Wrench size={13} />,
    plugin: <Package size={13} />,
    skill: <Bot size={13} />,
    mcp: <RefreshCw size={13} />,
};

/** The whole plugin manifest the UI fills in, so what lands on disk is what the agent reads. */
function manifestFrom(input: {
    name: string;
    description: string;
    domain: string;
    transport: "mcp" | "script";
    command: string;
    args: string;
    env: string;
    capabilities: string;
}): Record<string, unknown> {
    let env: Record<string, string> | undefined;
    if (input.env.trim()) {
        const parsed = JSON.parse(input.env) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("env must be a JSON object");
        env = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    }
    const args = input.args.trim() ? input.args.trim().split(/\s+/) : [];
    const capabilities = input.capabilities.split(",").map((id) => id.trim()).filter(Boolean);
    return {
        name: input.name.trim(),
        version: "0.1.0",
        description: input.description.trim() || `${input.name.trim()} plugin`,
        domain: input.domain.trim() || "stats",
        // An MCP plugin may contribute agent tools without declaring a capability.
        capabilities,
        priority: 0,
        transport: {
            type: input.transport,
            command: input.command.trim(),
            ...(args.length ? { args } : {}),
            ...(env ? { env } : {}),
        },
    };
}

export function CapabilitiesPage({
    notify,
    onApplied,
}: {
    notify: (message: string) => void;
    onApplied: (workspace: WorkspaceSnapshot) => void;
}) {
    const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
    const [error, setError] = useState("");
    const [pending, setPending] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [applying, setApplying] = useState(false);
    const [adding, setAdding] = useState<"plugin" | "skill" | null>(null);

    const load = async () => {
        try {
            const response = await fetch("/api/capabilities");
            const body = await readJson<CapabilitiesResponse>(response);
            if (!response.ok || body.ok === false) {
                throw new Error(body.ok === false ? body.error : `Capabilities unavailable (${response.status})`);
            }
            setCatalog(body);
            setError("");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    useEffect(() => {
        void load();
    }, []);

    /** Every capability mutation answers with the catalog it just wrote. */
    const post = async (path: string, payload: unknown, id: string): Promise<CapabilityChange | undefined> => {
        setPending(id);
        try {
            const response = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload ?? {}),
            });
            const body = await readJson<CapabilityChangeResponse>(response);
            if (!response.ok || body.ok === false) {
                throw new Error(body.ok === false ? body.error : "That change was refused.");
            }
            setCatalog(body.capabilities);
            return body;
        } catch (err) {
            notify(err instanceof Error ? err.message : String(err));
            return undefined;
        } finally {
            setPending(null);
        }
    };

    const toggle = async (entry: CapabilityEntry) => {
        const body = await post("/api/capabilities/toggle", { id: entry.id, enabled: !entry.enabled }, entry.id);
        if (!body) return;
        setDirty(true);
        notify(`${entry.name} ${entry.enabled ? "off" : "on"} — apply to give it to the agent`);
    };

    const apply = async () => {
        setApplying(true);
        try {
            const response = await fetch("/api/capabilities/apply", { method: "POST" });
            const body = await readJson<ApplyCapabilitiesResponse>(response);
            if (!response.ok || body.ok === false) {
                throw new Error(body.ok === false ? body.error : "Could not reopen the agent.");
            }
            onApplied(body.workspace);
            setCatalog(body.capabilities);
            setDirty(false);
            notify("Applied. The agent resumed its durable conversation.");
        } catch (err) {
            notify(err instanceof Error ? err.message : String(err));
        } finally {
            setApplying(false);
        }
    };

    /** Only what this page could have written: plugins/ under the project, workspace/skills. */
    const canRemove = (entry: CapabilityEntry): boolean => !catalog ? false
        : entry.kind === "skill"
            ? entry.source.startsWith(`${catalog.workspaceDir}/skills/`)
            : entry.kind === "plugin"
                ? entry.source.startsWith(`${catalog.projectRoot}/plugins/`)
                : false;

    const remove = async (entry: CapabilityEntry) => {
        const path = entry.kind === "skill" ? "/api/capabilities/skill/remove" : "/api/capabilities/plugin/remove";
        const body = await post(path, { name: entry.name }, `remove:${entry.id}`);
        if (!body) return;
        setDirty(true);
        notify(`${entry.name} removed from disk — apply to update the agent`);
    };

    const groups = useMemo(() => {
        const entries = catalog?.entries ?? [];
        return {
            plugin: entries.filter((entry) => entry.kind === "plugin"),
            skill: entries.filter((entry) => entry.kind === "skill"),
            tools: entries.filter((entry) => entry.kind === "tools"),
            mcp: entries.filter((entry) => entry.kind === "mcp"),
        };
    }, [catalog]);

    const enabledCount = (catalog?.entries ?? []).filter((entry) => entry.enabled).length;

    return (
        <div className="page-wrap">
            <div className="page-head">
                <div>
                    <div className="eyebrow">WORKSPACE</div>
                    <h1 className="page-title">Capabilities</h1>
                    <p className="page-subtitle">
                        What the agent can do, and what is switched off. Changes are saved now and reach the agent when you apply them.
                    </p>
                </div>
                <div className="top-actions">
                    <button className="button-secondary" onClick={() => void load()} disabled={pending !== null}>
                        <RefreshCw size={14} /> Reload
                    </button>
                    <button className="button-primary" onClick={() => void apply()} disabled={applying}>
                        {applying ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                        {dirty ? "Apply changes" : "Apply"}
                    </button>
                </div>
            </div>

            <div className="platform-highlights-bar" style={{ marginBottom: 18 }}>
                <div className="highlight-pill">
                    <Wrench size={13} style={{ color: "var(--green, #10b981)" }} />
                    <span>Built-in Tools:</span>
                    <b>{groups.tools.length} registered</b>
                </div>
                <div className="highlight-pill">
                    <Package size={13} style={{ color: "var(--indigo, #6366f1)" }} />
                    <span>MCP Plugins:</span>
                    <b>{groups.plugin.length} connected</b>
                </div>
                <div className="highlight-pill">
                    <Bot size={13} style={{ color: "#ff5e57" }} />
                    <span>Workspace Skills:</span>
                    <b>{groups.skill.length} compiled</b>
                </div>
                <div className="highlight-pill">
                    <Puzzle size={13} style={{ color: "var(--amber, #f59e0b)" }} />
                    <span>Enabled Capabilities:</span>
                    <b>{enabledCount} of {catalog?.entries.length ?? 0}</b>
                </div>
            </div>

            {error && <div className="workspace-banner">{error}</div>}
            {dirty && (
                <div className="workspace-banner">
                    Saved. The running agent still has the old set — press Apply to reopen it. A turn in flight blocks this.
                </div>
            )}

            <div className="settings-layout" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                <div>
                    <section className="panel settings-card">
                        <h3>Plugins · MCP servers and scripts</h3>
                        <p>
                            A plugin declares capabilities and publishes MCP tools, which the agent receives as
                            <span className="mono"> &lt;plugin&gt;__&lt;tool&gt;</span>. Manifests live in <span className="mono">plugins/&lt;name&gt;/plugin.json</span>.
                        </p>

                        {groups.plugin.length === 0 && (
                            <div className="empty-state" style={{ padding: "18px 10px" }}>
                                <Puzzle size={22} />
                                <b>No plugins installed</b>
                                <span>Add one below, or drop a manifest in {catalog?.projectRoot ?? "."}/plugins.</span>
                            </div>
                        )}

                        {groups.plugin.map((entry) => (
                            <CapabilityRow
                                key={entry.id}
                                entry={entry}
                                pending={pending === entry.id || pending === `remove:${entry.id}`}
                                onToggle={() => void toggle(entry)}
                                onRemove={canRemove(entry) ? () => void remove(entry) : undefined}
                            />
                        ))}

                        <div style={{ marginTop: 12 }}>
                            <button className="button-secondary" onClick={() => setAdding(adding === "plugin" ? null : "plugin")}>
                                <Plus size={13} /> Add plugin
                            </button>
                        </div>
                        {adding === "plugin" && (
                            <AddPluginForm
                                onCancel={() => setAdding(null)}
                                onSubmit={async (input) => {
                                    const body = await post("/api/capabilities/plugin", manifestFrom(input), "add:plugin");
                                    if (!body) return;
                                    setAdding(null);
                                    setDirty(true);
                                    notify(`${input.name} installed — apply to load its tools`);
                                }}
                            />
                        )}
                    </section>

                    <section className="panel settings-card">
                        <h3>Skills</h3>
                        <p>
                            Instructions the agent reads on demand. Workspace skills (<span className="mono">workspace/skills</span>)
                            override project and personal skills of the same name.
                        </p>

                        {groups.skill.length === 0 && (
                            <div className="empty-state" style={{ padding: "18px 10px" }}>
                                <Bot size={22} />
                                <b>No skills</b>
                                <span>Add one below, or write <span className="mono">workspace/skills/&lt;name&gt;/SKILL.md</span>.</span>
                            </div>
                        )}

                        {groups.skill.map((entry) => (
                            <CapabilityRow
                                key={entry.id}
                                entry={entry}
                                pending={pending === entry.id || pending === `remove:${entry.id}`}
                                onToggle={() => void toggle(entry)}
                                onRemove={canRemove(entry) ? () => void remove(entry) : undefined}
                            />
                        ))}

                        <div style={{ marginTop: 12 }}>
                            <button className="button-secondary" onClick={() => setAdding(adding === "skill" ? null : "skill")}>
                                <Plus size={13} /> Add skill
                            </button>
                        </div>
                        {adding === "skill" && (
                            <AddSkillForm
                                onCancel={() => setAdding(null)}
                                onSubmit={async (input) => {
                                    const body = await post("/api/capabilities/skill", input, "add:skill");
                                    if (!body) return;
                                    setAdding(null);
                                    setDirty(true);
                                    notify(`${input.name} added — apply to include it`);
                                }}
                            />
                        )}
                    </section>

                    <section className="panel settings-card">
                        <h3>Built-in tools and data sources</h3>
                        <p>Tool groups that ship with DataClaw, and the Databricks MCP connection the analyst tools use.</p>
                        {[...groups.tools, ...groups.mcp].map((entry) => (
                            <CapabilityRow
                                key={entry.id}
                                entry={entry}
                                pending={pending === entry.id}
                                onToggle={() => void toggle(entry)}
                            />
                        ))}
                    </section>

                    <section className="panel settings-card">
                        <h3>Where this is stored</h3>
                        <p>Everything on this page is a file you can edit by hand. Nothing lives only in the browser.</p>
                        <div className="form-row">
                            <div>
                                <label>{catalog?.configPath ?? "dataclaw.capabilities.json"}</label>
                                <small>{catalog?.disabled.length ?? 0} disabled · {enabledCount} enabled capabilities</small>
                            </div>
                            <span className="chip">{(catalog?.disabled ?? []).join(", ") || "nothing disabled"}</span>
                        </div>
                        <div className="form-row">
                            <div>
                                <label>{catalog?.projectRoot ?? "project root"}</label>
                                <small>plugins/ and dataclaw.capabilities.json are gitignored, so machine paths stay local.</small>
                            </div>
                            <span className="chip">{catalog?.workspaceDir ?? "workspace"}</span>
                        </div>
                        {(catalog?.errors ?? []).length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                {(catalog?.errors ?? []).map((message) => (
                                    <small key={message} style={{ display: "block", color: "#b15449" }}>{message}</small>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

function CapabilityRow({
    entry,
    pending,
    onToggle,
    onRemove,
}: {
    entry: CapabilityEntry;
    pending: boolean;
    onToggle: () => void;
    onRemove?: () => void;
}) {
    const removable = Boolean(onRemove) && (entry.kind === "plugin" || entry.kind === "skill");
    return (
        <div className="form-row" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {KIND_ICON[entry.kind]}
                    {entry.name}
                    {entry.details.version && <span className="chip">{entry.details.version}</span>}
                    {entry.details.domain && <span className="chip">{entry.details.domain}</span>}
                    {entry.details.transport && <span className="chip">{entry.details.transport}</span>}
                    {entry.details.skillSource && <span className="chip">{entry.details.skillSource}</span>}
                </label>
                <small>{entry.description}</small>
                <div className="data-chips" style={{ marginTop: 8 }}>
                    {entry.kind !== "tools" && <span className="chip">{KIND_LABEL[entry.kind]}</span>}
                    {(entry.details.tools ?? []).slice(0, 12).map((tool) => (
                        <span className="chip" key={tool}>{tool}</span>
                    ))}
                    {(entry.details.capabilities ?? []).map((capability) => (
                        <span
                            className="chip"
                            key={capability.id}
                            title={capability.winner ? "served by this plugin" : `shadowed by ${capability.shadowedBy ?? "another plugin"}`}
                            style={capability.winner ? undefined : { opacity: 0.55, textDecoration: "line-through" }}
                        >
                            {capability.id}
                        </span>
                    ))}
                </div>
                <div className="mono" style={{ marginTop: 6, opacity: 0.75 }}>{entry.source}</div>
                {entry.error && <small style={{ color: "#b15449" }}>{entry.error}</small>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {removable && (
                    <button className="icon-button" title={`Remove ${entry.name} from disk`} onClick={onRemove} disabled={pending}>
                        <Trash2 size={13} />
                    </button>
                )}
                {entry.toggleable ? (
                    <button
                        className={`toggle ${entry.enabled ? "on" : ""}`}
                        onClick={onToggle}
                        disabled={pending}
                        aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
                        title={entry.enabled ? "Enabled" : "Disabled"}
                    >
                        <i />
                    </button>
                ) : (
                    <span className="chip">{entry.enabled ? "always on" : "reported only"}</span>
                )}
            </div>
        </div>
    );
}

function AddPluginForm({
    onSubmit,
    onCancel,
}: {
    onSubmit: (input: {
        name: string; description: string; domain: string; transport: "mcp" | "script";
        command: string; args: string; env: string; capabilities: string;
    }) => void;
    onCancel: () => void;
}) {
    const [form, setForm] = useState({
        name: "",
        description: "",
        domain: "stats",
        transport: "mcp" as "mcp" | "script",
        command: "",
        args: "",
        env: "",
        capabilities: "",
    });
    const [localError, setLocalError] = useState("");
    const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm((current) => ({ ...current, [key]: event.target.value }));

    return (
        <div style={{ borderTop: "1px solid #efebe3", marginTop: 14, paddingTop: 12 }}>
            <div className="form-row" style={{ borderTop: 0, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Name</label>
                    <input value={form.name} onChange={set("name")} placeholder="teatools" />
                </div>
                <div style={{ flex: 1 }}>
                    <label>Domain</label>
                    <input value={form.domain} onChange={set("domain")} placeholder="stats" />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Description</label>
                    <input value={form.description} onChange={set("description")} placeholder="What it computes" />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Transport</label>
                    <select value={form.transport} onChange={set("transport")}>
                        <option value="mcp">mcp (stdio)</option>
                        <option value="script">script (JSON on stdin/stdout)</option>
                    </select>
                </div>
                <div style={{ flex: 2 }}>
                    <label>Command</label>
                    <input value={form.command} onChange={set("command")} placeholder="uv" />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Arguments (space separated)</label>
                    <input value={form.args} onChange={set("args")} placeholder="run --directory /path/to/server my-mcp" />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Environment (JSON, optional)</label>
                    <input value={form.env} onChange={set("env")} placeholder='{"PLAN_DIR": "/abs/path"}' />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Capabilities (comma separated, optional for MCP)</label>
                    <input value={form.capabilities} onChange={set("capabilities")} placeholder="stats.compare_eval_runs@1" />
                </div>
            </div>
            {localError && <small style={{ color: "#b15449" }}>{localError}</small>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button className="button-secondary" onClick={onCancel}>Cancel</button>
                <button
                    className="button-primary"
                    onClick={() => {
                        try {
                            if (!/^[a-z0-9][a-z0-9_.-]*$/.test(form.name.trim())) throw new Error("name must be lowercase letters, digits, dots, dashes or underscores");
                            if (!form.command.trim()) throw new Error("a command is required");
                            setLocalError("");
                            onSubmit(form);
                        } catch (err) {
                            setLocalError(err instanceof Error ? err.message : String(err));
                        }
                    }}
                >
                    <Plus size={13} /> Install
                </button>
            </div>
        </div>
    );
}

function AddSkillForm({
    onSubmit,
    onCancel,
}: {
    onSubmit: (input: { name: string; description: string; body: string }) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [body, setBody] = useState("");
    const [localError, setLocalError] = useState("");

    return (
        <div style={{ borderTop: "1px solid #efebe3", marginTop: 14, paddingTop: 12 }}>
            <div className="form-row" style={{ borderTop: 0, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Name</label>
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="experiment-readout" />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Description (one line, what the agent scans)</label>
                    <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Use when reporting an A/B test result." />
                </div>
            </div>
            <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <label>Instructions</label>
                    <textarea
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        placeholder="1. Read the plan. 2. Quote method and warnings. 3. Never invent a number."
                        style={{ width: "100%", minHeight: 90 }}
                    />
                </div>
            </div>
            {localError && <small style={{ color: "#b15449" }}>{localError}</small>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button className="button-secondary" onClick={onCancel}>Cancel</button>
                <button
                    className="button-primary"
                    onClick={() => {
                        if (!description.trim()) {
                            setLocalError("a one-line description is required: that is what the agent scans");
                            return;
                        }
                        setLocalError("");
                        onSubmit({ name, description, body });
                    }}
                >
                    <Plus size={13} /> Add skill
                </button>
            </div>
        </div>
    );
}
