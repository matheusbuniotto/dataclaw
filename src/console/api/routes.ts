/**
 * The console's one HTTP seam: a table of API routes and `handle(request)`, which turns a
 * plain `Request` into a `Response`. Nothing here listens — `server.ts` owns the only listener
 * and calls `startServer()` — so a test invokes any route without binding a port.
 *
 * Each entry declares how its request becomes input (query params or a JSON body) and calls
 * one domain function. `respond()` is the only place a status is decided: the returned value is
 * 200, a `DomainError` carries its own status (400 validation, 404 not found, 409 conflict),
 * and anything else is an unexpected failure, 500.
 */
import { abortMainAgent, askMainAgent, consoleDataSources, consolePlugins, consoleReport, consoleWorkspace } from "./workspace";
import {
    applyCapabilities,
    capabilitiesCatalog,
    installPlugin,
    installSkill,
    toggleCapability,
    uninstallPlugin,
    uninstallSkill,
} from "./capabilities-api";
import {
    cancelBrowserOAuth,
    connectDatabricks,
    disconnectDatabricks,
    getDatabricksUiStatus,
    getOAuthFlow,
    reconnectDatabricks,
    startBrowserOAuth,
} from "./databricks-api";
import { checkPlugins } from "./plugins-api";
import {
    DomainError,
    NotFoundError,
    ValidationError,
    type DatabricksConnectInput,
} from "./wire";

/** One method on one path. The reader turns the request into exactly the input `run` takes. */
export interface Route {
    /** Absent when the route takes no input. */
    input?: (request: Request) => unknown;
    /** The one domain function this route calls. `never` because the table is heterogeneous. */
    run: (input: never) => unknown;
}

/** Each entry is type-checked where it is written; the table itself holds every shape. */
export type RouteTable = Record<string, { GET?: Route; POST?: Route }>;

// ---------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------

/** A JSON object body, or `{}` when the client sent none: every field is read, never trusted. */
async function body(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed = (await request.json()) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

/** A field the request must carry, trimmed. The message names the field, not the route. */
function required(value: unknown, field: string): string {
    const found = text(value)?.trim();
    if (!found) throw new ValidationError(`${field} is required`);
    return found;
}

/** Service-principal credentials, or nothing: both halves are needed before they are used. */
function oauthCredentials(value: unknown): DatabricksConnectInput["oauth"] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const clientId = text(input.clientId);
    const clientSecret = text(input.clientSecret);
    if (!clientId || !clientSecret) return undefined;
    const scope = text(input.scope);
    return { clientId, clientSecret, ...(scope ? { scope } : {}) };
}

/** The ask the console can carry: a goal worth submitting, short enough for one turn. */
function askInput(input: Record<string, unknown>): { content: string; agentId?: string } {
    const content = required(input.content, "content");
    if (content.length > 20_000) throw new ValidationError("That request is too long.");
    return { content, agentId: text(input.agentId) };
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const routes: RouteTable = {
    "/api/workspace": {
        GET: {
            input: async (request) => ({ agentId: text(new URL(request.url).searchParams.get("agentId")) }),
            run: ({ agentId }) => consoleWorkspace(agentId),
        },
    },
    "/api/datasources": {
        GET: {
            input: async (request) => ({ agentId: text(new URL(request.url).searchParams.get("agentId")) }),
            run: ({ agentId }) => consoleDataSources(agentId),
        },
    },
    "/api/report": {
        GET: {
            input: async (request) => {
                const url = new URL(request.url);
                return {
                    format: text(url.searchParams.get("format")) ?? "json",
                    agentId: text(url.searchParams.get("agentId")),
                };
            },
            run: ({ format, agentId }) => consoleReport(format, agentId),
        },
    },
    "/api/agent/ask": {
        POST: {
            input: async (request) => askInput(await body(request)),
            run: ({ content, agentId }) => askMainAgent(content, agentId),
        },
    },
    "/api/agent/abort": {
        POST: {
            input: async (request) => ({ agentId: text((await body(request)).agentId) }),
            run: async ({ agentId }) => {
                await abortMainAgent(agentId);
                return { workspace: await consoleWorkspace(agentId) };
            },
        },
    },

    "/api/capabilities": {
        GET: { run: () => capabilitiesCatalog() },
    },
    "/api/capabilities/toggle": {
        POST: {
            input: async (request) => {
                const input = await body(request);
                const enabled = input.enabled;
                if (typeof enabled !== "boolean") throw new ValidationError("\"enabled\" must be true or false");
                return { id: required(input.id, "id"), enabled };
            },
            run: async (input) => ({ capabilities: await toggleCapability(input) }),
        },
    },
    "/api/capabilities/plugin": {
        POST: {
            // A manifest on its own is also accepted: the form posts the manifest it built.
            input: async (request) => {
                const input = await body(request);
                return input.manifest ?? input;
            },
            run: (manifest) => installPlugin(manifest),
        },
    },
    "/api/capabilities/plugin/remove": {
        POST: {
            input: async (request) => ({ name: required((await body(request)).name, "name") }),
            run: async ({ name }) => ({ capabilities: await uninstallPlugin(name) }),
        },
    },
    "/api/capabilities/skill": {
        POST: {
            input: async (request) => {
                const input = await body(request);
                return { name: text(input.name), description: text(input.description), body: text(input.body) };
            },
            run: (input) => installSkill(input),
        },
    },
    "/api/capabilities/skill/remove": {
        POST: {
            input: async (request) => ({ name: required((await body(request)).name, "name") }),
            run: async ({ name }) => ({ capabilities: await uninstallSkill(name) }),
        },
    },
    "/api/capabilities/apply": {
        // Reopens the harness, so a turn in flight refuses it: that refusal is a conflict.
        POST: { run: () => applyCapabilities() },
    },

    "/api/plugins": {
        GET: { run: () => consolePlugins() },
    },
    // The console's twin of `bun run plugins:list --check`. It starts each MCP plugin, so
    // it runs only when asked, never on page load.
    "/api/plugins/check": {
        POST: { run: async () => ({ checks: await checkPlugins() }) },
    },

    "/api/databricks/status": {
        GET: { run: () => getDatabricksUiStatus() },
    },
    "/api/databricks/connect": {
        POST: {
            input: async (request) => {
                const input = await body(request);
                return {
                    profile: text(input.profile),
                    host: text(input.host),
                    token: text(input.token),
                    warehouseId: text(input.warehouseId),
                    oauth: oauthCredentials(input.oauth),
                } satisfies DatabricksConnectInput;
            },
            run: async (input) => ({ status: await connectDatabricks(input) }),
        },
    },
    "/api/databricks/reconnect": {
        POST: { run: async () => ({ status: await reconnectDatabricks() }) },
    },
    "/api/databricks/disconnect": {
        POST: { run: async () => ({ status: await disconnectDatabricks() }) },
    },
    "/api/databricks/oauth/start": {
        POST: {
            input: async (request) => ({ host: text((await body(request)).host) }),
            run: (input) => startBrowserOAuth(input),
        },
    },
    "/api/databricks/oauth/status": {
        GET: { run: () => getOAuthFlow() },
    },
    "/api/databricks/oauth/cancel": {
        POST: {
            run: () => {
                cancelBrowserOAuth();
                return getOAuthFlow();
            },
        },
    },
};

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * The one rule from a domain outcome to a response: a returned value is `{ ok: true, ...value }`
 * at 200, a `DomainError` is `{ ok: false, error, ...payload }` at its own status, and anything
 * else — a harness, storage or network failure — is a 500. A thunk, so the input reader and the
 * domain function are both inside it.
 */
export async function respond(run: () => unknown): Promise<Response> {
    try {
        const value = await run();
        const payload = value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
        return json({ ok: true, ...payload });
    } catch (err) {
        if (err instanceof DomainError) {
            return json({ ok: false, error: message(err), ...err.payload }, err.status);
        }
        return json({ ok: false, error: message(err) }, 500);
    }
}

/** Read the request through the route's declared input, then run its one domain function. */
export async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const methods = routes[pathname];
    if (!methods) return respond(() => { throw new NotFoundError(`No route for ${pathname}`) });

    const route = request.method === "GET" || request.method === "POST" ? methods[request.method] : undefined;
    if (!route) {
        return respond(() => {
            throw new DomainError(405, `${request.method} is not allowed on ${pathname}`);
        });
    }

    return respond(async () => {
        const input = route.input ? await route.input(request) : undefined;
        return route.run(input as never);
    });
}
