/**
 * The console's HTTP wire: what a route accepts, what it answers, and the one reader the pages
 * use to decode an answer. `routes.ts` serves these shapes and the client imports them, so a
 * field is declared once instead of copied into the page that renders it.
 *
 * Nothing here listens or reads a request: this module is types, the failure classes a domain
 * function throws, and `readJson`.
 */
import type { CapabilityCatalog } from "../../capabilities/catalog";
import type { ProviderDescriptor } from "../../datasource/session";
import type { SourceStatus } from "../../datasource/types";
import type { DatabricksProfileInfo } from "../../mcp/databricks-config";
import type { PluginCheck, PluginsSummary } from "./plugins-api";
import type { WorkspaceSnapshot } from "../state/workspace-types";

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * A domain failure with the status the console answers. `payload` is extra JSON for the failure
 * body: the Databricks routes attach the status snapshot so the panel can render what is
 * actually connected when a connect fails. Anything that is not a `DomainError` is a bug or an
 * environment failure, and `routes.ts` reports it as a 500.
 */
export class DomainError extends Error {
    readonly status: number;
    readonly payload: Record<string, unknown>;

    constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
        super(message);
        this.name = "DomainError";
        this.status = status;
        this.payload = payload;
    }
}

/** The caller sent something the domain function will not accept (400). */
export class ValidationError extends DomainError {
    constructor(message: string) {
        super(400, message);
        this.name = "ValidationError";
    }
}

/** The agent is in the way: a turn is running, so the change cannot land yet (409). */
export class ConflictError extends DomainError {
    constructor(message: string) {
        super(409, message);
        this.name = "ConflictError";
    }
}

/** The path, agent, plugin or skill named by the request is not here (404). */
export class NotFoundError extends DomainError {
    constructor(message: string) {
        super(404, message);
        this.name = "NotFoundError";
    }
}

/** A Databricks call failed; the status snapshot travels with the message (400). */
export class DatabricksStatusError extends DomainError {
    constructor(message: string, status: DatabricksUiStatus) {
        super(400, message, { status });
        this.name = "DatabricksStatusError";
    }
}

// ---------------------------------------------------------------------------
// Databricks auth
// ---------------------------------------------------------------------------

export type DatabricksAuthMethod = "env" | "config" | "cli" | "token" | "oauth";
export type DatabricksOAuthMode = "u2m" | "m2m";

/** What the auth panel renders. Never includes a token. */
export interface DatabricksUiStatus {
    connected: boolean;
    configured: boolean;
    host?: string;
    mcpUrl?: string;
    profile?: string;
    authMethod?: DatabricksAuthMethod;
    oauthMode?: DatabricksOAuthMode;
    tokenExpiresAt?: number;
    warehouseId?: string;
    catalogs: string[];
    user?: string;
    userName?: string;
    userEmail?: string;
    userInitials?: string;
    userRole?: string;
    hasUserToken?: boolean;
    connectedAt?: number;
    profiles: DatabricksProfileInfo[];
    defaultProfile: string;
    error?: string;
    isApp?: boolean;
    appId?: string;
    appName?: string;
    hasLakePostgres?: boolean;
    connectionsCount?: number;
    genieSpacesCount?: number;
    mlflowExperiment?: string;
    mlflowEnabled?: boolean;
}

export interface GenieSpaceSummary {
    spaceId: string;
    title: string;
    description?: string;
    warehouseId?: string;
}

export interface LakehouseConnectionSummary {
    name: string;
    connectionType: string;
    comment?: string;
    host?: string;
}

export interface MlflowStatusSummary {
    enabled: boolean;
    experimentPath?: string;
    host?: string;
}

/** What the auth panel posts to connect: a CLI profile, a host, a PAT, and/or client credentials. */
export interface DatabricksConnectInput {
    profile?: string;
    host?: string;
    token?: string;
    warehouseId?: string;
    /** Service-principal OAuth (client credentials). */
    oauth?: {
        clientId: string;
        clientSecret: string;
        scope?: string;
    };
}

/** Browser (U2M) sign-in progress, polled by the auth panel. */
export interface DatabricksOAuthFlow {
    state: "idle" | "pending" | "success" | "error";
    host?: string;
    authorizeUrl?: string;
    startedAt?: number;
    error?: string;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** The only shape a failure takes on the wire. */
export interface ApiFailure {
    ok: false;
    error: string;
}

/** Every successful answer is the domain value with `ok: true`; every failure is `ApiFailure`. */
export type ApiResponse<T> = ({ ok: true } & T) | ApiFailure;

export type WorkspaceResponse = ApiResponse<WorkspaceSnapshot>;
export interface DataSourcesFacts {
    providers: ProviderDescriptor[];
    status: SourceStatus;
}
export type DataSourcesResponse = ApiResponse<DataSourcesFacts>;
export type AgentAskResponse = ApiResponse<{ submissionId: string; agentId: string }>;
export type AgentAbortResponse = ApiResponse<{ workspace: WorkspaceSnapshot }>;

export type DatabricksStatusResponse = ApiResponse<DatabricksUiStatus>;
/** connect/reconnect/disconnect: the status after the change, or the one it failed with. */
export type DatabricksAuthResponse =
    | { ok: true; status: DatabricksUiStatus }
    | { ok: false; error: string; status?: DatabricksUiStatus };
export type DatabricksOAuthFlowResponse = ApiResponse<DatabricksOAuthFlow>;
export type DatabricksOAuthStartResponse = ApiResponse<{ authorizeUrl: string; host: string; port: number }>;

export type PluginsResponse = ApiResponse<PluginsSummary>;
export type PluginCheckResponse = ApiResponse<{ checks: PluginCheck[] }>;

export type CapabilitiesResponse = ApiResponse<CapabilityCatalog>;
/** Every capability mutation answers with the catalog it just wrote. */
export interface CapabilityChange {
    capabilities: CapabilityCatalog;
}
export type CapabilityChangeResponse = ApiResponse<CapabilityChange>;
export type PluginInstallResponse = ApiResponse<{ name: string; path: string; capabilities: CapabilityCatalog }>;
export type ApplyCapabilitiesResponse = ApiResponse<{ workspace: WorkspaceSnapshot; capabilities: CapabilityCatalog }>;

// ---------------------------------------------------------------------------
// Reading an answer
// ---------------------------------------------------------------------------

/**
 * The one reader every page uses. `response.json()` in Safari reports a non-JSON body as
 * "The string did not match the expected pattern.", which hides the real status, so the body is
 * read as text first and an empty or HTML answer becomes a message that names the status.
 */
export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
    const text = await response.text();
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!snippet) throw new Error(`Empty response from the console (${response.status}).`);
    try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`The console returned an unexpected response (${response.status}).`);
        }
        return parsed as T;
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("The console returned")) throw err;
        if (snippet.startsWith("<")) {
            throw new Error(`The console returned an unexpected response (${response.status}).`);
        }
        throw new Error(snippet);
    }
}
