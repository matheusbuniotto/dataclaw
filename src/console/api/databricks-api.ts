/**
 * The auth panel's domain: what is connected, how to connect, and how a failure is reported.
 * A failed call throws `DatabricksStatusError`, which carries the status snapshot so the panel
 * renders what is actually connected next to the message.
 */

import { randomBytes } from "node:crypto";
import { DatabricksDataAdapter } from "../../adapters/databricks-adapter";
import {
    describeDatabricksConfig,
    listDatabricksProfiles,
} from "../../mcp/databricks-config";
import {
    buildAuthorizeUrl,
    DatabricksOAuthError,
    DatabricksOAuthSession,
    generatePkcePair,
    normalizeOAuthHost,
} from "../../mcp/databricks-oauth";
import {
    DatabricksStatusError,
    ValidationError,
    type DatabricksAuthMethod,
    type DatabricksConnectInput,
    type DatabricksOAuthFlow,
    type DatabricksOAuthMode,
    type DatabricksUiStatus,
} from "./wire";

interface LiveConnection {
    adapter: DatabricksDataAdapter;
    host: string;
    mcpUrl: string;
    profile?: string;
    authMethod: DatabricksAuthMethod;
    oauthMode?: DatabricksOAuthMode;
    oauthSession?: DatabricksOAuthSession;
    warehouseId?: string;
    catalogs: string[];
    user?: string;
    connectedAt: number;
    tokenExpiresAt?: number;
}

let connection: LiveConnection | null = null;
let lastError: string | undefined;

type DatabricksSessionListener = (adapter: DatabricksDataAdapter | null) => void;
const sessionListeners = new Set<DatabricksSessionListener>();

/** Fires with the live adapter after connect, and null after disconnect. */
export function subscribeDatabricks(listener: DatabricksSessionListener): () => void {
    sessionListeners.add(listener);
    listener(connection?.adapter ?? null);
    return () => sessionListeners.delete(listener);
}

function publishDatabricksSession(): void {
    const adapter = connection?.adapter ?? null;
    for (const listener of sessionListeners) {
        try {
            listener(adapter);
        } catch (err) {
            console.error("Databricks session listener failed:", err);
        }
    }
}

/**
 * Publish an adapter opened outside the auth panel (harness startup) so the
 * console and the agent share one MCP session.
 */
export async function adoptDatabricksAdapter(
    adapter: DatabricksDataAdapter,
    authMethod: DatabricksAuthMethod = adapter.options.profile ? "cli" : "env",
): Promise<DatabricksUiStatus> {
    return establishConnection(adapter, { authMethod });
}

function defaultProfile(): string {
    return process.env.DATABRICKS_PROFILE ?? "DEFAULT";
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Serialize current auth/connection state for the console. Never includes a token. */
export function getDatabricksUiStatus(): DatabricksUiStatus {
    const profiles = listDatabricksProfiles();

    if (connection) {
        return {
            connected: true,
            configured: true,
            host: connection.host,
            mcpUrl: connection.mcpUrl,
            ...(connection.profile ? { profile: connection.profile } : {}),
            authMethod: connection.authMethod,
            ...(connection.oauthMode ? { oauthMode: connection.oauthMode } : {}),
            ...(connection.tokenExpiresAt ? { tokenExpiresAt: connection.tokenExpiresAt } : {}),
            ...(connection.warehouseId ? { warehouseId: connection.warehouseId } : {}),
            catalogs: connection.catalogs,
            ...(connection.user ? { user: connection.user } : {}),
            connectedAt: connection.connectedAt,
            profiles,
            defaultProfile: defaultProfile(),
        };
    }

    const summary = describeDatabricksConfig();
    return {
        connected: false,
        configured: summary.configured,
        ...(summary.host ? { host: summary.host } : {}),
        ...(summary.url ? { mcpUrl: summary.url } : {}),
        ...(summary.profile ? { profile: summary.profile } : {}),
        ...(summary.authMethod ? { authMethod: summary.authMethod } : {}),
        ...(summary.tokenExpiresAt ? { tokenExpiresAt: summary.tokenExpiresAt } : {}),
        ...(summary.error || lastError ? { error: summary.error ?? lastError } : {}),
        catalogs: [],
        profiles,
        defaultProfile: defaultProfile(),
    };
}

async function probeUser(adapter: DatabricksDataAdapter): Promise<string | undefined> {
    try {
        const result = await adapter.query("SELECT current_user() AS current_user", 1);
        const value = result.rows[0]?.current_user;
        return typeof value === "string" ? value : undefined;
    } catch {
        return undefined;
    }
}

async function establishConnection(
    adapter: DatabricksDataAdapter,
    meta: {
        authMethod: DatabricksAuthMethod;
        oauthMode?: DatabricksOAuthMode;
        oauthSession?: DatabricksOAuthSession;
        warehouseId?: string;
        tokenExpiresAt?: number;
    },
): Promise<DatabricksUiStatus> {
    const catalogs = await adapter.listCatalogs().catch(() => [] as string[]);
    const user = await probeUser(adapter);

    const previous = connection;
    connection = {
        adapter,
        host: adapter.options.host ?? "",
        mcpUrl: adapter.options.mcpUrl ?? "",
        ...(adapter.options.profile ? { profile: adapter.options.profile } : {}),
        authMethod: meta.authMethod,
        ...(meta.oauthMode ? { oauthMode: meta.oauthMode } : {}),
        ...(meta.oauthSession ? { oauthSession: meta.oauthSession } : {}),
        ...(adapter.options.warehouseId ? { warehouseId: adapter.options.warehouseId } : {}),
        catalogs,
        ...(user ? { user } : {}),
        connectedAt: Date.now(),
        ...(meta.tokenExpiresAt ? { tokenExpiresAt: meta.tokenExpiresAt } : {}),
    };

    if (previous && previous.adapter !== adapter) {
        await previous.adapter.close().catch(() => { });
    }

    publishDatabricksSession();
    return getDatabricksUiStatus();
}

/** Fill in the status snapshot a failed auth call reports next to its message, and record it. */
function authFailure(err: unknown): never {
    if (err instanceof DatabricksStatusError) throw err;
    throw new DatabricksStatusError(recordDatabricksAuthError(err), getDatabricksUiStatus());
}

/** Authenticate with a CLI profile, PAT, env credentials, or service-principal OAuth. */
export async function connectDatabricks(input: DatabricksConnectInput = {}): Promise<DatabricksUiStatus> {
    lastError = undefined;
    try {
        return await openDatabricksConnection(input);
    } catch (err) {
        authFailure(err);
    }
}

async function openDatabricksConnection(input: DatabricksConnectInput): Promise<DatabricksUiStatus> {
    if (input.oauth) {
        const host = input.host?.trim() || describeDatabricksConfig().host;
        if (!host) {
            throw new DatabricksOAuthError("A workspace URL is required for service-principal OAuth.");
        }
        const session = await DatabricksOAuthSession.fromClientCredentials({
            host,
            clientId: input.oauth.clientId,
            clientSecret: input.oauth.clientSecret,
            scope: input.oauth.scope,
        });
        return completeOAuthConnection(session, input.warehouseId);
    }

    const adapter = await DatabricksDataAdapter.connect({
        profile: input.profile,
        host: input.host,
        token: input.token,
        warehouseId: input.warehouseId,
    });

    const authMethod: DatabricksAuthMethod = input.token
        ? "token"
        : adapter.options.profile
            ? "cli"
            : "env";

    return establishConnection(adapter, { authMethod });
}

/** Complete a browser (U2M) or service-principal (M2M) OAuth connection. */
async function completeOAuthConnection(
    session: DatabricksOAuthSession,
    warehouseId?: string,
): Promise<DatabricksUiStatus> {
    const adapter = await DatabricksDataAdapter.connect(
        {
            host: session.host,
            token: await session.getAccessToken(),
            ...(warehouseId ? { warehouseId } : {}),
        },
        { tokenProvider: async (force) => {
            if (force) await session.refresh();
            return session.getAccessToken();
        } },
    );

    return establishConnection(adapter, {
        authMethod: "oauth",
        oauthMode: session.oauthMode,
        oauthSession: session,
        ...(warehouseId ? { warehouseId } : {}),
        tokenExpiresAt: session.expiresAtMs,
    });
}

/** Re-mint the token and reopen the session for the current workspace. */
export async function reconnectDatabricks(): Promise<DatabricksUiStatus> {
    if (!connection) throw new ValidationError("Databricks is not connected.");

    try {
        if (connection.oauthSession) {
            await connection.oauthSession.refresh();
            return await completeOAuthConnection(connection.oauthSession, connection.warehouseId);
        }

        const { host, profile, warehouseId } = connection;
        return await connectDatabricks({
            host,
            ...(profile ? { profile } : {}),
            ...(warehouseId ? { warehouseId } : {}),
        });
    } catch (err) {
        authFailure(err);
    }
}

export async function disconnectDatabricks(): Promise<DatabricksUiStatus> {
    const previous = connection;
    connection = null;
    publishDatabricksSession();
    if (previous) await previous.adapter.close().catch(() => { });
    return getDatabricksUiStatus();
}

/** Record a failure for the next status read without leaking credentials. Returns the message. */
export function recordDatabricksAuthError(error: unknown): string {
    lastError = errorText(error);
    return lastError;
}

// ---------------------------------------------------------------------------
// Browser OAuth (U2M) flow
// ---------------------------------------------------------------------------

const OAUTH_PORT = 8020;
const OAUTH_TIMEOUT_MS = 10 * 60_000;

interface PendingOAuth {
    state: string;
    verifier: string;
    host: string;
    redirectUri: string;
    exchanging?: boolean;
    completed?: boolean;
}

let oauthFlow: DatabricksOAuthFlow = { state: "idle" };
let oauthServer: ReturnType<typeof Bun.serve> | null = null;
let oauthPending: PendingOAuth | null = null;
let oauthTimer: ReturnType<typeof setTimeout> | null = null;

export function getOAuthFlow(): DatabricksOAuthFlow {
    return { ...oauthFlow };
}

function stopOAuthListener(deferServerStop = false): void {
    if (oauthTimer) {
        clearTimeout(oauthTimer);
        oauthTimer = null;
    }
    const server = oauthServer;
    oauthServer = null;
    oauthPending = null;
    if (!server) return;

    const stop = () => {
        try {
            server.stop(true);
        } catch {
            // Already stopped.
        }
    };

    if (deferServerStop) {
        // Let the current HTTP response flush before closing the listener.
        setTimeout(stop, 100);
    } else {
        stop();
    }
}

function failOAuth(message: string, deferServerStop = false): void {
    stopOAuthListener(deferServerStop);
    oauthFlow = { state: "error", error: message };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function oauthResultPage(message: string, ok: boolean): Response {
    const color = ok ? "#276d60" : "#a04d41";
    const background = ok ? "#eaf4ec" : "#f9eae5";
    const border = ok ? "#cfe5d6" : "#efcfc5";
    return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>Databricks sign-in</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f9f7f1;color:#203a37;font:14px system-ui,-apple-system,sans-serif}
.card{max-width:460px;margin:24px;background:#fffdf8;border:1px solid ${border};border-radius:14px;padding:26px;box-shadow:0 18px 50px #142e2a1f}
.badge{display:inline-block;background:${background};color:${color};border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
h1{font-size:19px;margin:14px 0 8px}
p{font-size:13px;line-height:1.55;color:#65766d;margin:0}
code{font-size:11px;background:#f1f2e9;padding:3px 5px;border-radius:4px}
</style></head><body><div class="card">
<span class="badge">${ok ? "Connected" : "Sign-in failed"}</span>
<h1>${ok ? "Databricks is connected" : "Databricks sign-in did not complete"}</h1>
<p>${escapeHtml(message)}</p>
<p style="margin-top:12px">${ok ? "You can close this tab and return to the DataClaw console." : "Return to the console to try again."}</p>
<button onclick="window.close()" style="margin-top:16px;border:1px solid #d9ddd2;background:#f7f7ef;color:#40564d;border-radius:8px;padding:8px 12px;font:600 12px system-ui,sans-serif;cursor:pointer">Close this tab</button>
</div>${ok ? "<script>setTimeout(()=>window.close(),1200)</script>" : ""}</body></html>`,
        {
            status: ok ? 200 : 400,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        },
    );
}

async function handleOAuthCallback(req: Request): Promise<Response> {
    try {
        return await handleOAuthCallbackInner(req);
    } catch (err) {
        const message = errorText(err);
        failOAuth(message, true);
        return oauthResultPage(message, false);
    }
}

async function handleOAuthCallbackInner(req: Request): Promise<Response> {
    // Only the browser redirect (GET) may consume the one-time code. HEAD/OPTIONS
    // probes must not exchange it.
    if (req.method !== "GET") {
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }

    const url = new URL(req.url);
    if (url.pathname !== "/" && url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
    }

    const pending = oauthPending;
    if (!pending) {
        if (oauthFlow.state === "success") {
            return oauthResultPage("Databricks is already connected. Return to the console.", true);
        }
        return oauthResultPage("No Databricks sign-in is in progress. Start again from the console.", false);
    }

    // A code is single-use. If the browser retries or refreshes the callback,
    // report the existing success instead of trying to exchange it again.
    if (pending.completed) {
        return oauthResultPage("Databricks is already connected. Return to the console.", true);
    }
    if (pending.exchanging) {
        return oauthResultPage("Databricks sign-in is already completing. Return to the console in a moment.", true);
    }

    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    if (error) {
        const message = errorDescription || error;
        failOAuth(message, true);
        return oauthResultPage(message, false);
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code || returnedState !== pending.state) {
        const message = "Databricks returned an invalid OAuth response (state/code mismatch).";
        failOAuth(message, true);
        return oauthResultPage(message, false);
    }

    pending.exchanging = true;
    try {
        console.log("[databricks-oauth] exchanging authorization code");
        const session = await DatabricksOAuthSession.fromAuthorizationCode({
            host: pending.host,
            code,
            codeVerifier: pending.verifier,
            redirectUri: pending.redirectUri,
        });
        await completeOAuthConnection(session);
        pending.completed = true;
        oauthFlow = { state: "success", host: pending.host };
        console.log("[databricks-oauth] browser sign-in completed");
        stopOAuthListener(true);
        return oauthResultPage("Your Databricks workspace is now available to the durable data team.", true);
    } catch (err) {
        pending.exchanging = false;
        const message = errorText(err);

        // A duplicate callback can race a successful exchange. Do not report
        // failure if the secure session is already live.
        if (oauthFlow.state === "success") {
            return oauthResultPage("Databricks is already connected. Return to the console.", true);
        }

        console.error(`[databricks-oauth] sign-in failed: ${message}`);
        failOAuth(message, true);
        return oauthResultPage(message, false);
    }
}

/** Start a browser OAuth flow and return the URL the user must open. */
export function startBrowserOAuth(input: { host?: string; port?: number } = {}): {
    authorizeUrl: string;
    host: string;
    port: number;
} {
    try {
        return openBrowserOAuth(input);
    } catch (err) {
        // A missing host or a busy callback port is something the user fixes in the panel.
        throw new ValidationError(recordDatabricksAuthError(err));
    }
}

function openBrowserOAuth(input: { host?: string; port?: number }): {
    authorizeUrl: string;
    host: string;
    port: number;
} {
    stopOAuthListener();

    const hostValue = input.host?.trim() || describeDatabricksConfig().host;
    if (!hostValue) {
        throw new DatabricksOAuthError(
            "A workspace URL is required. Enter it in the OAuth panel or configure a CLI profile first.",
        );
    }
    const host = normalizeOAuthHost(hostValue);
    const { verifier, challenge } = generatePkcePair();
    const state = randomBytes(24).toString("base64url");
    const requestedPort = input.port ?? OAUTH_PORT;

    oauthPending = { state, verifier, host, redirectUri: "" };

    try {
        oauthServer = Bun.serve({
            port: requestedPort,
            hostname: "::",
            fetch: handleOAuthCallback,
        });
    } catch (err) {
        oauthPending = null;
        throw new DatabricksOAuthError(
            `Could not open the OAuth callback listener on port ${requestedPort}: ${errorText(err)}. ` +
            "Close any other Databricks login flow and try again.",
        );
    }

    const port = oauthServer.port ?? requestedPort;
    const redirectUri = `http://localhost:${port}`;
    oauthPending.redirectUri = redirectUri;

    const authorizeUrl = buildAuthorizeUrl({
        host,
        state,
        codeChallenge: challenge,
        redirectUri,
    });

    oauthFlow = { state: "pending", host, authorizeUrl, startedAt: Date.now() };
    oauthTimer = setTimeout(() => failOAuth("Timed out waiting for browser sign-in."), OAUTH_TIMEOUT_MS);
    console.log(`[databricks-oauth] waiting for browser callback on ${redirectUri}`);

    return { authorizeUrl, host, port };
}

export function cancelBrowserOAuth(): void {
    const wasPending = oauthFlow.state === "pending";
    stopOAuthListener();
    if (wasPending) oauthFlow = { state: "idle" };
}

/** Test/reset hook. */
export async function resetDatabricksConnection(): Promise<void> {
    stopOAuthListener();
    oauthFlow = { state: "idle" };
    await disconnectDatabricks();
    lastError = undefined;
}
