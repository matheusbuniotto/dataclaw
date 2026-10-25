import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Connection settings for the Databricks-managed SQL MCP server.
 *
 * The managed endpoint lives at:
 *   https://<workspace-host>/api/2.0/mcp/sql
 *
 * It is a streamable HTTP MCP server authenticated with a Databricks bearer
 * token (PAT or OAuth token minted by the Databricks CLI).
 */
export interface DatabricksMcpConfig {
    /** Full MCP endpoint URL. */
    url: string;
    /** Workspace base URL, e.g. https://dbc-123.cloud.databricks.com */
    host: string;
    /** Bearer token used for the MCP request. */
    token: string;
    /** Databricks CLI profile the token was resolved from, when applicable. */
    profile?: string;
    /** Optional default SQL warehouse (the managed MCP endpoint picks its own). */
    warehouseId?: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /** Default execution mode. */
    readOnly: boolean;
    /** Where the bearer token came from. */
    tokenSource?: "env" | "config" | "cli";
    /** Token expiry (JWT `exp`), when the token is a JWT. */
    tokenExpiresAt?: number;
}

export interface DatabricksConfigOverrides {
    url?: string;
    host?: string;
    token?: string;
    profile?: string;
    warehouseId?: string;
    timeoutMs?: number;
    readOnly?: boolean;
}

export class DatabricksConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DatabricksConfigError";
    }
}

const DEFAULT_PROFILE = "DEFAULT";
const DEFAULT_TIMEOUT_MS = 120_000;
const TOKEN_REFRESH_WINDOW_MS = 60_000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** All profiles in ~/.databrickscfg (or DATABRICKS_CONFIG_FILE). */
export function readAllDatabricksCfg(): Record<string, Record<string, string>> {
    const path = process.env.DATABRICKS_CONFIG_FILE ?? join(homedir(), ".databrickscfg");
    if (!existsSync(path)) return {};

    const sections: Record<string, Record<string, string>> = {};
    let current = "";
    for (const rawLine of readFileSync(path, "utf-8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith(";")) continue;

        const section = line.match(/^\[(.+)\]$/);
        if (section) {
            current = section[1]?.trim() ?? "";
            if (!sections[current]) sections[current] = {};
            continue;
        }
        if (!current) continue;

        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        sections[current]![line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return sections;
}

/** Read the `[profile]` section of ~/.databrickscfg (or DATABRICKS_CONFIG_FILE). */
export function readDatabricksCfg(profile = DEFAULT_PROFILE): Record<string, string> {
    return readAllDatabricksCfg()[profile] ?? {};
}

export interface DatabricksProfileInfo {
    name: string;
    host?: string;
    /** A PAT is stored in the profile (OAuth profiles rely on cached CLI tokens). */
    hasToken: boolean;
    /** Databricks CLI auth_type, when present. */
    authType?: string;
}

/** Profiles the auth UI can offer, without exposing any token value. */
export function listDatabricksProfiles(): DatabricksProfileInfo[] {
    return Object.entries(readAllDatabricksCfg())
        .filter(([name]) => !name.startsWith("__"))
        .map(([name, values]) => ({
            name,
            host: values.host,
            hasToken: Boolean(values.token),
            ...(values.auth_type ? { authType: values.auth_type } : {}),
        }))
        .sort((a, b) => {
            if (a.name === DEFAULT_PROFILE) return -1;
            if (b.name === DEFAULT_PROFILE) return 1;
            return a.name.localeCompare(b.name);
        });
}

function jwtExpiry(token: string): number | undefined {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
        return typeof decoded.exp === "number" ? decoded.exp * 1000 : undefined;
    } catch {
        return undefined;
    }
}

function resolveCliToken(profile: string): string {
    const cached = tokenCache.get(profile);
    if (cached && cached.expiresAt - TOKEN_REFRESH_WINDOW_MS > Date.now()) {
        return cached.token;
    }

    let raw: string;
    try {
        raw = execFileSync("databricks", ["auth", "token", "--profile", profile], {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 30_000,
        });
    } catch (err: unknown) {
        const detail = (err instanceof Error && "stderr" in err && (err as { stderr?: { toString?(): string } }).stderr?.toString?.().trim()) ||
            (err instanceof Error ? err.message : String(err));
        throw new DatabricksConfigError(
            `Could not obtain a Databricks token for profile "${profile}": ${detail}. ` +
            `Run "databricks auth login --profile ${profile}" or set DATABRICKS_TOKEN.`,
        );
    }

    let token: string | undefined;
    try {
        token = JSON.parse(raw)?.access_token;
    } catch {
        token = raw.trim() || undefined;
    }
    if (!token) {
        throw new DatabricksConfigError(
            `Databricks CLI returned no access_token for profile "${profile}".`,
        );
    }

    tokenCache.set(profile, {
        token,
        expiresAt: jwtExpiry(token) ?? Date.now() + 50 * 60_000,
    });
    return token;
}

function normalizeHost(host: string): string {
    const trimmed = host.trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Resolve Databricks connection details from (in priority order):
 * explicit overrides -> DATABRICKS_* environment variables -> ~/.databrickscfg
 * -> `databricks auth token`.
 */
export function resolveDatabricksConfig(overrides: DatabricksConfigOverrides = {}): DatabricksMcpConfig {
    const profile = overrides.profile ?? process.env.DATABRICKS_PROFILE ?? DEFAULT_PROFILE;
    const cfg = readDatabricksCfg(profile);

    const hostValue = overrides.host ?? process.env.DATABRICKS_HOST ?? cfg.host;
    if (!hostValue) {
        throw new DatabricksConfigError(
            `No Databricks workspace configured. Set DATABRICKS_HOST, pass host, or add a [${profile}] section to ~/.databrickscfg.`,
        );
    }
    const host = normalizeHost(hostValue);

    const url = overrides.url ?? process.env.DATABRICKS_MCP_URL ?? `${host}/api/2.0/mcp/sql`;

    const explicitToken = overrides.token ?? process.env.DATABRICKS_TOKEN;
    const tokenSource: "env" | "config" | "cli" = explicitToken ? "env" : cfg.token ? "config" : "cli";
    const token = explicitToken ?? cfg.token ?? resolveCliToken(profile);

    const timeoutRaw = overrides.timeoutMs ?? Number(process.env.DATABRICKS_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw! > 0 ? timeoutRaw! : DEFAULT_TIMEOUT_MS;

    const readOnly = overrides.readOnly ?? process.env.DATABRICKS_READ_ONLY !== "false";

    return {
        url,
        host,
        token,
        profile: explicitToken ? undefined : profile,
        warehouseId: overrides.warehouseId ?? process.env.DATABRICKS_WAREHOUSE_ID,
        timeoutMs,
        readOnly,
        tokenSource,
        tokenExpiresAt: jwtExpiry(token),
    };
}

export interface DatabricksConfigSummary {
    configured: boolean;
    host?: string;
    profile?: string;
    url?: string;
    authMethod?: "env" | "config" | "cli";
    tokenExpiresAt?: number;
    error?: string;
}

/** Cheap, non-throwing probe used by prompt sections, the UI, and CLI status output. */
export function describeDatabricksConfig(overrides: DatabricksConfigOverrides = {}): DatabricksConfigSummary {
    try {
        const cfg = resolveDatabricksConfig(overrides);
        return {
            configured: true,
            host: cfg.host,
            profile: cfg.profile,
            url: cfg.url,
            authMethod: cfg.tokenSource,
            ...(cfg.tokenExpiresAt ? { tokenExpiresAt: cfg.tokenExpiresAt } : {}),
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { configured: false, error: message };
    }
}
