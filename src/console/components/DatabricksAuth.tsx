import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    CheckCircle2,
    Cloud,
    Database,
    ExternalLink,
    KeyRound,
    Loader2,
    PlugZap,
    RefreshCw,
    ShieldCheck,
    Terminal,
    X,
} from "lucide-react";

import {
    readJson,
    type DatabricksAuthMethod,
    type DatabricksAuthResponse,
    type DatabricksConnectInput,
    type DatabricksOAuthMode,
    type DatabricksOAuthFlow,
    type DatabricksOAuthFlowResponse,
    type DatabricksOAuthStartResponse,
    type DatabricksStatusResponse,
    type DatabricksUiStatus,
} from "../api/wire";

type AuthState = {
    status: DatabricksUiStatus | null;
    loading: boolean;
    busy: boolean;
    error: string | null;
    oauthFlow: DatabricksOAuthFlow;
    refresh: (quiet?: boolean) => Promise<void>;
    connect: (input: DatabricksConnectInput) => Promise<boolean>;
    reconnect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
    startOAuth: (host: string) => Promise<string | null>;
    cancelOAuth: () => Promise<void>;
    clearError: () => void;
};

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function apiError(res: Response, data: object): Error {
    if (res.status === 404) {
        return new Error(
            "Databricks auth API not found (404). The console server is running an older build — " +
            "restart it with `bun run console` and refresh this page.",
        );
    }
    const message = "error" in data && typeof data.error === "string" ? data.error : undefined;
    return new Error(message ?? `Request failed (${res.status})`);
}

/** Client-side state for the Databricks auth panel, backed by the console server. */
export function useDatabricksAuth(): AuthState {
    const [status, setStatus] = useState<DatabricksUiStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [oauthFlow, setOauthFlow] = useState<DatabricksOAuthFlow>({ state: "idle" });

    const refresh = useCallback(async (quiet = false) => {
        if (!quiet) setLoading(true);
        try {
            const res = await fetch("/api/databricks/status");
            const data = await readJson<DatabricksStatusResponse>(res);
            if (!res.ok || data.ok === false) throw apiError(res, data);
            setStatus(data);
            setError(null);
        } catch (err) {
            setError(errorText(err));
        } finally {
            if (!quiet) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        void (async () => {
            try {
                const res = await fetch("/api/databricks/oauth/status");
                const data = await readJson<DatabricksOAuthFlowResponse>(res);
                if (data.ok === true && data.state === "pending") {
                    setOauthFlow({
                        state: "pending",
                        host: data.host,
                        authorizeUrl: data.authorizeUrl,
                    });
                }
            } catch {
                // The console may be running without the auth API.
            }
        })();
    }, [refresh]);

    const post = useCallback(async (path: string, body?: unknown): Promise<boolean> => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body ?? {}),
            });
            const data = await readJson<DatabricksAuthResponse>(res);
            // A failed connect still reports what is connected, so the panel never goes blank.
            if (data.status) setStatus(data.status);
            if (!res.ok || data.ok === false) {
                throw apiError(res, data);
            }
            setStatus(data.status);
            return true;
        } catch (err) {
            setError(errorText(err));
            return false;
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => {
        if (oauthFlow.state !== "pending") return;
        let cancelled = false;
        const timer = setInterval(async () => {
            try {
                const res = await fetch("/api/databricks/oauth/status");
                const data = await readJson<DatabricksOAuthFlowResponse>(res);
                if (cancelled || data.ok === false) return;
                if (data.state === "success") {
                    setOauthFlow({ state: "success", host: data.host });
                    await refresh(true);
                } else if (data.state === "error") {
                    setOauthFlow({ state: "error", error: data.error });
                    setError(data.error ?? "Databricks sign-in failed.");
                }
            } catch {
                // Transient network error; keep polling while the flow is pending.
            }
        }, 1500);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [oauthFlow.state, refresh]);

    const startOAuth = useCallback(async (host: string): Promise<string | null> => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/databricks/oauth/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ host }),
            });
            const data = await readJson<DatabricksOAuthStartResponse>(res);
            if (!res.ok || data.ok === false) {
                throw apiError(res, data);
            }
            setOauthFlow({
                state: "pending",
                host: data.host,
                authorizeUrl: data.authorizeUrl,
            });
            return data.authorizeUrl;
        } catch (err) {
            setError(errorText(err));
            return null;
        } finally {
            setBusy(false);
        }
    }, []);

    const cancelOAuth = useCallback(async () => {
        try {
            await fetch("/api/databricks/oauth/cancel", { method: "POST" });
        } catch {
            // Best effort.
        }
        setOauthFlow({ state: "idle" });
    }, []);

    return {
        status,
        loading,
        busy,
        error,
        oauthFlow,
        refresh,
        connect: (input) => post("/api/databricks/connect", input),
        reconnect: () => post("/api/databricks/reconnect"),
        disconnect: () => post("/api/databricks/disconnect"),
        startOAuth,
        cancelOAuth,
        clearError: () => setError(null),
    };
}

export function authMethodLabel(method?: DatabricksAuthMethod, oauthMode?: DatabricksOAuthMode): string {
    switch (method) {
        case "cli":
            return "Databricks CLI profile";
        case "config":
            return "Profile token";
        case "env":
            return "Environment credentials";
        case "token":
            return "Personal access token";
        case "oauth":
            return oauthMode === "m2m" ? "OAuth · service principal" : "OAuth · browser sign-in";
        default:
            return "Not authenticated";
    }
}

function expiryLabel(timestamp?: number): string | undefined {
    if (!timestamp) return undefined;
    const remaining = timestamp - Date.now();
    if (remaining <= 0) return "expired";
    const minutes = Math.round(remaining / 60_000);
    return minutes < 60 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`;
}

function StatusPill({ status, loading }: { status: DatabricksUiStatus | null; loading: boolean }) {
    if (loading) return <span className="status-pill status-idle">Checking</span>;
    if (status?.connected) return <span className="status-pill status-connected">Connected</span>;
    if (status?.configured) return <span className="status-pill status-warning">Ready to connect</span>;
    return <span className="status-pill status-idle">Not authenticated</span>;
}

export function DatabricksAuthCard({
    auth,
    onManage,
}: {
    auth: AuthState;
    onManage: () => void;
}) {
    const { status, loading } = auth;
    return (
        <section className="panel settings-card">
            <div className="auth-card-head">
                <div>
                    <h3>Databricks Unity Catalog</h3>
                    <p>Read-only SQL over the managed Databricks SQL MCP server.</p>
                </div>
                <StatusPill status={status} loading={loading} />
            </div>

            <div className="auth-summary">
                <div className="auth-summary-row">
                    <span>Workspace</span>
                    <b>{status?.host ?? "Not configured"}</b>
                </div>
                <div className="auth-summary-row">
                    <span>Authentication</span>
                    <b>
                        {status?.connected
                            ? authMethodLabel(status.authMethod, status.oauthMode)
                            : status?.configured
                                ? authMethodLabel(status.authMethod, status.oauthMode)
                                : "Add a CLI profile or token"}
                    </b>
                </div>
                <div className="auth-summary-row">
                    <span>Unity Catalog</span>
                    <b>
                        {status?.connected
                            ? status.catalogs.length
                                ? `${status.catalogs.length} catalogs visible`
                                : "Connected · no catalog listing"
                            : "Not connected"}
                    </b>
                </div>
            </div>

            {status?.error && !status.connected && (
                <div className="auth-error" style={{ marginTop: 12 }}>
                    {status.error}
                </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <button className="button-secondary" onClick={onManage}>
                    <ShieldCheck size={14} />
                    {status?.connected ? "Manage access" : "Connect Databricks"}
                </button>
                {status?.connected && (
                    <button
                        className="button-quiet"
                        onClick={() => auth.refresh()}
                        disabled={auth.busy}
                    >
                        <RefreshCw size={14} /> Refresh status
                    </button>
                )}
            </div>
        </section>
    );
}

export function DatabricksAuthModal({
    open,
    auth,
    onClose,
    notify,
}: {
    open: boolean;
    auth: AuthState;
    onClose: () => void;
    notify: (message: string) => void;
}) {
    const { status, busy, error } = auth;
    const [mode, setMode] = useState<"cli" | "oauth" | "token">("cli");
    const [oauthMode, setOauthMode] = useState<"browser" | "service">("browser");
    const [profile, setProfile] = useState("");
    const [host, setHost] = useState("");
    const [token, setToken] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [scope, setScope] = useState("sql");
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open && !wasOpen.current) {
            const profiles = status?.profiles ?? [];
            const preferred = profiles.find((entry) => entry.name === status?.defaultProfile) ?? profiles[0];
            setProfile(preferred?.name ?? status?.defaultProfile ?? "DEFAULT");
            setHost(status?.host ?? "");
            setToken("");
            setClientId("");
            setClientSecret("");
            setScope("sql");
            setMode("cli");
            setOauthMode("browser");
            auth.clearError();
            void auth.refresh(true);
        }
        wasOpen.current = open;
    }, [open, status, auth]);

    if (!open) return null;

    const profiles = status?.profiles ?? [];
    const selectedProfile = profiles.find((entry) => entry.name === profile);
    const connected = Boolean(status?.connected);
    const oauthFlow = auth.oauthFlow;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (mode === "oauth") return;

        const input: DatabricksConnectInput = mode === "cli"
            ? { profile: profile || status?.defaultProfile }
            : { host: host.trim(), token: token.trim() };

        const ok = await auth.connect(input);
        if (ok) {
            setToken("");
            notify("Databricks workspace connected via MCP.");
        }
    };

    const startBrowserSignIn = async () => {
        // Open the tab synchronously so popup blockers do not reject the redirect.
        const popup = window.open("", "databricks-oauth", "popup,width=540,height=760");
        const url = await auth.startOAuth(host.trim());
        if (!url) {
            popup?.close();
            return;
        }
        if (popup) {
            popup.opener = null;
            popup.location.href = url;
        } else {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    };

    const connectServicePrincipal = async () => {
        const ok = await auth.connect({
            host: host.trim(),
            oauth: {
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
                scope: scope.trim() || "sql",
            },
        });
        if (ok) {
            setClientSecret("");
            notify("Databricks service principal connected via OAuth.");
        }
    };

    const disconnect = async () => {
        const ok = await auth.disconnect();
        if (ok) notify("Databricks access removed from this console.");
    };

    const reconnect = async () => {
        const ok = await auth.reconnect();
        if (ok) notify("Databricks token refreshed and MCP session reopened.");
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="modal auth-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Databricks access"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="auth-head">
                    <span className="auth-mark">
                        <PlugZap size={18} />
                    </span>
                    <div style={{ flex: 1 }}>
                        <h2>Databricks access</h2>
                        <p>Authenticate the durable data team against Unity Catalog over MCP.</p>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={onClose}>
                        <X size={15} />
                    </button>
                </div>

                {connected ? (
                    <div>
                        <div className="auth-success">
                            <CheckCircle2 size={18} />
                            <div>
                                <b>Connected to {status?.host}</b>
                                <span>
                                    {status?.user ? `Signed in as ${status.user}` : "Workspace session active"}
                                    {status?.profile ? ` · profile ${status.profile}` : ""}
                                </span>
                            </div>
                        </div>

                        <div className="auth-kv">
                            <div>
                                <span>MCP endpoint</span>
                                <b className="mono">{status?.mcpUrl}</b>
                            </div>
                            <div>
                                <span>Authentication</span>
                                <b>{authMethodLabel(status?.authMethod, status?.oauthMode)}</b>
                            </div>
                            <div>
                                <span>Token</span>
                                <b>
                                    {status?.tokenExpiresAt
                                        ? `Expires ${expiryLabel(status.tokenExpiresAt)}`
                                        : status?.authMethod === "cli"
                                            ? "Managed by the Databricks CLI"
                                            : "Static token (no expiry reported)"}
                                </b>
                            </div>
                            <div>
                                <span>Warehouse</span>
                                <b>{status?.warehouseId ?? "Managed MCP default"}</b>
                            </div>
                        </div>

                        <div className="section-label" style={{ marginTop: 16 }}>Visible catalogs</div>
                        <div className="data-chips">
                            {status?.catalogs.length
                                ? status.catalogs.map((catalog) => (
                                    <span className="chip" key={catalog}>
                                        <Database size={10} style={{ marginRight: 4, verticalAlign: "-1px" }} />
                                        {catalog}
                                    </span>
                                ))
                                : <span className="chip">No catalogs listed for this identity</span>}
                        </div>

                        {error && <div className="auth-error" style={{ marginTop: 14 }}>{error}</div>}

                        <div className="modal-footer">
                            <button className="button-quiet" onClick={disconnect} disabled={busy}>
                                Disconnect
                            </button>
                            <button className="button-secondary" onClick={reconnect} disabled={busy}>
                                {busy ? <Loader2 size={14} className="auth-spin" /> : <RefreshCw size={14} />}
                                Refresh token
                            </button>
                            <button className="button-primary" onClick={onClose}>
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={submit}>
                        <div className="auth-tabs">
                            <button
                                type="button"
                                className={`auth-tab ${mode === "cli" ? "active" : ""}`}
                                onClick={() => setMode("cli")}
                            >
                                <Terminal size={13} /> CLI profile
                            </button>
                            <button
                                type="button"
                                className={`auth-tab ${mode === "oauth" ? "active" : ""}`}
                                onClick={() => setMode("oauth")}
                            >
                                <ShieldCheck size={13} /> OAuth
                            </button>
                            <button
                                type="button"
                                className={`auth-tab ${mode === "token" ? "active" : ""}`}
                                onClick={() => setMode("token")}
                            >
                                <KeyRound size={13} /> Access token
                            </button>
                        </div>

                        {mode === "cli" ? (
                            <div>
                                {profiles.length > 0 ? (
                                    <>
                                        <label htmlFor="dbx-profile">Databricks CLI profile</label>
                                        <select
                                            id="dbx-profile"
                                            className="field-input"
                                            style={{ width: "100%" }}
                                            value={profile}
                                            onChange={(event) => setProfile(event.target.value)}
                                        >
                                            {profiles.map((entry) => (
                                                <option value={entry.name} key={entry.name}>
                                                    {entry.name}
                                                    {entry.host ? ` · ${entry.host.replace(/^https?:\/\//, "")}` : ""}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="auth-hint">
                                            <Cloud size={13} />
                                            <span>
                                                {selectedProfile?.host ?? status?.host ?? "Workspace resolved from the profile"}
                                                {selectedProfile?.authType ? ` · ${selectedProfile.authType}` : ""}
                                            </span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="auth-empty">
                                        <Terminal size={18} />
                                        <b>No CLI profiles found</b>
                                        <span>Sign in once from a terminal, then refresh this panel.</span>
                                        <code>databricks auth login --profile DEFAULT</code>
                                    </div>
                                )}
                                <button
                                    type="button"
                                    className="text-link"
                                    style={{ marginTop: 10 }}
                                    onClick={() => auth.refresh(true)}
                                >
                                    <RefreshCw size={12} style={{ marginRight: 5 }} />
                                    Refresh profiles
                                </button>
                            </div>
                        ) : mode === "oauth" ? (
                            <div>
                                <div className="auth-subtabs">
                                    <button
                                        type="button"
                                        className={`auth-subtab ${oauthMode === "browser" ? "active" : ""}`}
                                        onClick={() => setOauthMode("browser")}
                                    >
                                        Browser sign-in
                                    </button>
                                    <button
                                        type="button"
                                        className={`auth-subtab ${oauthMode === "service" ? "active" : ""}`}
                                        onClick={() => setOauthMode("service")}
                                    >
                                        Service principal
                                    </button>
                                </div>

                                {oauthMode === "browser" ? (
                                    <div>
                                        <label htmlFor="dbx-oauth-host">Workspace URL</label>
                                        <input
                                            id="dbx-oauth-host"
                                            className="field-input"
                                            style={{ width: "100%" }}
                                            placeholder="https://dbc-xxxx.cloud.databricks.com"
                                            value={host}
                                            onChange={(event) => setHost(event.target.value)}
                                            autoComplete="off"
                                        />

                                        {oauthFlow.state === "pending" ? (
                                            <div className="auth-oauth-wait">
                                                <Loader2 size={20} className="auth-spin" />
                                                <b>Waiting for browser sign-in…</b>
                                                <span>
                                                    Complete the Databricks sign-in in the browser tab. This panel updates
                                                    automatically when the callback lands.
                                                </span>
                                                <a
                                                    className="button-secondary"
                                                    href={oauthFlow.authorizeUrl ?? "#"}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    <ExternalLink size={14} /> Open sign-in page
                                                </a>
                                                <button
                                                    type="button"
                                                    className="text-link"
                                                    onClick={() => void auth.cancelOAuth()}
                                                >
                                                    Cancel sign-in
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="auth-hint">
                                                    <ShieldCheck size={13} />
                                                    <span>
                                                        OAuth 2.0 with PKCE using the public Databricks CLI client. A
                                                        localhost listener on port 8020 completes the redirect.
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="button-primary"
                                                    style={{ marginTop: 12 }}
                                                    onClick={startBrowserSignIn}
                                                    disabled={busy || !host.trim()}
                                                >
                                                    {busy
                                                        ? <Loader2 size={14} className="auth-spin" />
                                                        : <ExternalLink size={14} />}
                                                    Sign in with browser
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <label htmlFor="dbx-sp-host">Workspace URL</label>
                                        <input
                                            id="dbx-sp-host"
                                            className="field-input"
                                            style={{ width: "100%" }}
                                            placeholder="https://dbc-xxxx.cloud.databricks.com"
                                            value={host}
                                            onChange={(event) => setHost(event.target.value)}
                                            autoComplete="off"
                                        />
                                        <label htmlFor="dbx-sp-client">Client ID</label>
                                        <input
                                            id="dbx-sp-client"
                                            className="field-input"
                                            style={{ width: "100%" }}
                                            placeholder="Service principal application ID"
                                            value={clientId}
                                            onChange={(event) => setClientId(event.target.value)}
                                            autoComplete="off"
                                        />
                                        <label htmlFor="dbx-sp-secret">Client secret</label>
                                        <input
                                            id="dbx-sp-secret"
                                            className="field-input"
                                            style={{ width: "100%" }}
                                            type="password"
                                            placeholder="OAuth secret"
                                            value={clientSecret}
                                            onChange={(event) => setClientSecret(event.target.value)}
                                            autoComplete="off"
                                        />
                                        <label htmlFor="dbx-sp-scope">Scope</label>
                                        <input
                                            id="dbx-sp-scope"
                                            className="field-input"
                                            style={{ width: "100%" }}
                                            value={scope}
                                            onChange={(event) => setScope(event.target.value)}
                                            autoComplete="off"
                                        />
                                        <div className="auth-hint">
                                            <ShieldCheck size={13} />
                                            <span>
                                                Client-credentials OAuth. The service principal needs workspace access and
                                                the <code>sql</code> scope. Secrets stay in server memory only.
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            className="button-primary"
                                            style={{ marginTop: 12 }}
                                            onClick={connectServicePrincipal}
                                            disabled={busy || !host.trim() || !clientId.trim() || !clientSecret.trim()}
                                        >
                                            {busy
                                                ? <Loader2 size={14} className="auth-spin" />
                                                : <ShieldCheck size={14} />}
                                            Connect service principal
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <label htmlFor="dbx-host">Workspace URL</label>
                                <input
                                    id="dbx-host"
                                    className="field-input"
                                    style={{ width: "100%" }}
                                    placeholder="https://dbc-xxxx.cloud.databricks.com"
                                    value={host}
                                    onChange={(event) => setHost(event.target.value)}
                                    autoComplete="off"
                                />
                                <label htmlFor="dbx-token">Personal access token</label>
                                <input
                                    id="dbx-token"
                                    className="field-input"
                                    style={{ width: "100%" }}
                                    type="password"
                                    placeholder="dapi…"
                                    value={token}
                                    onChange={(event) => setToken(event.target.value)}
                                    autoComplete="off"
                                />
                                <div className="auth-hint">
                                    <ShieldCheck size={13} />
                                    <span>
                                        Sent only to this local console. The token is held in memory and never written to a
                                        durable document.
                                    </span>
                                </div>
                            </div>
                        )}

                        {error && <div className="auth-error" style={{ marginTop: 14 }}>{error}</div>}

                        <div className="modal-footer">
                            <button type="button" className="button-quiet" onClick={onClose}>
                                Cancel
                            </button>
                            {mode !== "oauth" && (
                                <button
                                    type="submit"
                                    className="button-primary"
                                    disabled={
                                        busy ||
                                        (mode === "cli"
                                            ? !profile && profiles.length === 0
                                            : !host.trim() || !token.trim())
                                    }
                                >
                                    {busy ? <Loader2 size={14} className="auth-spin" /> : <PlugZap size={14} />}
                                    {busy ? "Verifying workspace…" : "Connect"}
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
