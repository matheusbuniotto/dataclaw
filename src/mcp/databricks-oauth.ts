import { createHash, randomBytes } from "node:crypto";

/**
 * Databricks OAuth helpers.
 *
 * Two flows are supported:
 *  - U2M browser sign-in using the public `databricks-cli` OAuth client and
 *    PKCE. The redirect matches the CLI's registered callback (`localhost:8020`).
 *  - M2M service-principal client credentials.
 *
 * Tokens are held in memory by a session object; nothing is written to disk.
 */

export const DATABRICKS_OAUTH_CLIENT_ID = "databricks-cli";
export const DATABRICKS_OAUTH_REDIRECT_URI = "http://localhost:8020";
export const DATABRICKS_U2M_SCOPE = "offline_access sql";
export const DATABRICKS_M2M_SCOPE = "sql";

const TOKEN_TIMEOUT_MS = 30_000;
const EXPIRY_SKEW_MS = 60_000;

export class DatabricksOAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DatabricksOAuthError";
    }
}

export function normalizeOAuthHost(host: string): string {
    const trimmed = host.trim().replace(/\/+$/, "");
    if (!trimmed) throw new DatabricksOAuthError("A Databricks workspace URL is required.");
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function generatePkcePair(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export function buildAuthorizeUrl(options: {
    host: string;
    state: string;
    codeChallenge: string;
    redirectUri?: string;
    clientId?: string;
    scope?: string;
}): string {
    const host = normalizeOAuthHost(options.host);
    const params = new URLSearchParams({
        client_id: options.clientId ?? DATABRICKS_OAUTH_CLIENT_ID,
        code_challenge: options.codeChallenge,
        code_challenge_method: "S256",
        redirect_uri: options.redirectUri ?? DATABRICKS_OAUTH_REDIRECT_URI,
        response_type: "code",
        scope: options.scope ?? DATABRICKS_U2M_SCOPE,
        state: options.state,
    });
    return `${host}/oidc/v1/authorize?${params.toString()}`;
}

export interface OAuthTokenSet {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    scope?: string;
}

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

async function postToken(
    host: string,
    body: URLSearchParams,
    authorization?: string,
): Promise<TokenResponse> {
    let response: Response;
    try {
        response = await fetch(`${normalizeOAuthHost(host)}/oidc/v1/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                ...(authorization ? { Authorization: authorization } : {}),
            },
            body: body.toString(),
            signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        });
    } catch (err: any) {
        throw new DatabricksOAuthError(
            `Could not reach the Databricks OAuth token endpoint: ${err?.message ?? String(err)}`,
        );
    }

    const text = await response.text();
    let payload: TokenResponse = {};
    try {
        payload = JSON.parse(text) as TokenResponse;
    } catch {
        // Non-JSON error body; fall back to text below.
    }

    if (!response.ok || !payload.access_token) {
        const detail = payload.error_description || payload.error || text.slice(0, 240) || `HTTP ${response.status}`;
        throw new DatabricksOAuthError(`Databricks OAuth token request failed: ${detail}`);
    }
    return payload;
}

function toTokenSet(payload: TokenResponse): OAuthTokenSet {
    if (!payload.access_token) throw new DatabricksOAuthError("Databricks returned no access token.");
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    return {
        accessToken: payload.access_token,
        ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
        expiresAt: Date.now() + Math.max(expiresIn * 1000 - EXPIRY_SKEW_MS, 30_000),
        ...(payload.scope ? { scope: payload.scope } : {}),
    };
}

export async function exchangeAuthorizationCode(options: {
    host: string;
    code: string;
    codeVerifier: string;
    redirectUri?: string;
    clientId?: string;
}): Promise<OAuthTokenSet> {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: options.code,
        code_verifier: options.codeVerifier,
        redirect_uri: options.redirectUri ?? DATABRICKS_OAUTH_REDIRECT_URI,
        client_id: options.clientId ?? DATABRICKS_OAUTH_CLIENT_ID,
    });
    return toTokenSet(await postToken(options.host, body));
}

export async function requestClientCredentialsToken(options: {
    host: string;
    clientId: string;
    clientSecret: string;
    scope?: string;
}): Promise<OAuthTokenSet> {
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        scope: options.scope ?? DATABRICKS_M2M_SCOPE,
    });
    const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");
    return toTokenSet(await postToken(options.host, body, `Basic ${basic}`));
}

async function refreshAuthorizationCodeToken(options: {
    host: string;
    refreshToken: string;
    clientId?: string;
}): Promise<OAuthTokenSet> {
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: options.refreshToken,
        client_id: options.clientId ?? DATABRICKS_OAUTH_CLIENT_ID,
    });
    return toTokenSet(await postToken(options.host, body));
}

/**
 * In-memory OAuth session. Refreshes shortly before expiry and surfaces a
 * clean error when a U2M session can no longer be refreshed.
 */
export class DatabricksOAuthSession {
    private accessTokenValue: string;
    private expiresAt: number;
    private refreshTokenValue?: string;
    private scopeValue: string;
    private refreshing?: Promise<void>;

    private constructor(
        readonly host: string,
        readonly mode: "u2m" | "m2m",
        tokens: OAuthTokenSet,
        private readonly clientId: string,
        private readonly clientSecret: string | undefined,
        scope: string,
    ) {
        this.accessTokenValue = tokens.accessToken;
        this.expiresAt = tokens.expiresAt;
        this.refreshTokenValue = tokens.refreshToken;
        this.scopeValue = tokens.scope ?? scope;
    }

    static async fromAuthorizationCode(options: {
        host: string;
        code: string;
        codeVerifier: string;
        redirectUri?: string;
        clientId?: string;
        scope?: string;
    }): Promise<DatabricksOAuthSession> {
        const clientId = options.clientId ?? DATABRICKS_OAUTH_CLIENT_ID;
        const tokens = await exchangeAuthorizationCode(options);
        return new DatabricksOAuthSession(
            normalizeOAuthHost(options.host),
            "u2m",
            tokens,
            clientId,
            undefined,
            options.scope ?? DATABRICKS_U2M_SCOPE,
        );
    }

    static async fromClientCredentials(options: {
        host: string;
        clientId: string;
        clientSecret: string;
        scope?: string;
    }): Promise<DatabricksOAuthSession> {
        if (!options.clientId || !options.clientSecret) {
            throw new DatabricksOAuthError("A service principal client ID and secret are required.");
        }
        const scope = options.scope ?? DATABRICKS_M2M_SCOPE;
        const tokens = await requestClientCredentialsToken({ ...options, scope });
        return new DatabricksOAuthSession(
            normalizeOAuthHost(options.host),
            "m2m",
            tokens,
            options.clientId,
            options.clientSecret,
            scope,
        );
    }

    get oauthMode(): "u2m" | "m2m" {
        return this.mode;
    }

    get expiresAtMs(): number {
        return this.expiresAt;
    }

    private apply(tokens: OAuthTokenSet): void {
        this.accessTokenValue = tokens.accessToken;
        this.expiresAt = tokens.expiresAt;
        if (tokens.refreshToken) this.refreshTokenValue = tokens.refreshToken;
        if (tokens.scope) this.scopeValue = tokens.scope;
    }

    async getAccessToken(): Promise<string> {
        if (Date.now() >= this.expiresAt) await this.refresh();
        return this.accessTokenValue;
    }

    async refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing;

        this.refreshing = (async () => {
            if (this.mode === "m2m") {
                if (!this.clientSecret) throw new DatabricksOAuthError("The service principal secret is unavailable.");
                this.apply(await requestClientCredentialsToken({
                    host: this.host,
                    clientId: this.clientId,
                    clientSecret: this.clientSecret,
                    scope: this.scopeValue,
                }));
                return;
            }

            if (!this.refreshTokenValue) {
                throw new DatabricksOAuthError(
                    "The Databricks browser session expired. Sign in with Databricks again.",
                );
            }
            this.apply(await refreshAuthorizationCodeToken({
                host: this.host,
                refreshToken: this.refreshTokenValue,
                clientId: this.clientId,
            }));
        })().finally(() => {
            this.refreshing = undefined;
        });

        return this.refreshing;
    }
}
