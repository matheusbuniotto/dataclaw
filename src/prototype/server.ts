// Stillwork: Durable Agent Data Platform (DataClaw Console)
import indexHtml from "./index.html";
import {
    cancelBrowserOAuth,
    connectDatabricks,
    disconnectDatabricks,
    getDatabricksUiStatus,
    getOAuthFlow,
    reconnectDatabricks,
    recordDatabricksAuthError,
    startBrowserOAuth,
} from "./databricks-api";
import { abortMainAgent, askMainAgent, consoleDataSources, consoleWorkspace } from "./workspace";
import { checkPlugins, pluginsSummary } from "./plugins-api";
import {
    applyCapabilities,
    capabilitiesCatalog,
    installPlugin,
    installSkill,
    toggleCapability,
    uninstallPlugin,
    uninstallSkill,
} from "./capabilities-api";

const port = Number(process.env.PORT) || 3000;
// Local-only by default: the auth endpoints can mint Databricks sessions.
const hostname = process.env.HOST || "127.0.0.1";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Safari reports a non-JSON body as "The string did not match the expected pattern." */
function jsonError(error: unknown, status = 500): Response {
    return json({ ok: false, error: errorMessage(error) }, status);
}

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
    try {
        return (await req.json()) as Record<string, unknown>;
    } catch {
        return {};
    }
}

const server = Bun.serve({
    port,
    hostname,
    // The first workspace open can spend time on Databricks MCP auth.
    idleTimeout: 60,
    routes: {
        "/api/workspace": {
            GET: async (req) => {
                try {
                    const agentId = new URL(req.url).searchParams.get("agentId") ?? undefined;
                    return json(await consoleWorkspace(agentId));
                } catch (err) {
                    return json({ ok: false, error: errorMessage(err) }, 500);
                }
            },
        },
        "/api/datasources": {
            GET: async (req) => {
                try {
                    const agentId = new URL(req.url).searchParams.get("agentId") ?? undefined;
                    return json(await consoleDataSources(agentId));
                } catch (err) {
                    return jsonError(err);
                }
            },
        },
        "/api/agent/ask": {
            POST: async (req) => {
                const input = await readBody(req);
                try {
                    const result = await askMainAgent(
                        typeof input.content === "string" ? input.content : "",
                        typeof input.agentId === "string" ? input.agentId : undefined,
                    );
                    return json({ ok: true, ...result });
                } catch (err) {
                    return json({ ok: false, error: errorMessage(err) }, 400);
                }
            },
        },
        "/api/agent/abort": {
            POST: async (req) => {
                const input = await readBody(req);
                const agentId = typeof input.agentId === "string" ? input.agentId : undefined;
                try {
                    await abortMainAgent(agentId);
                    return json({ ok: true, workspace: await consoleWorkspace(agentId) });
                } catch (err) {
                    return json({ ok: false, error: errorMessage(err) }, 400);
                }
            },
        },
        "/api/databricks/status": {
            GET: () => json(getDatabricksUiStatus()),
        },
        "/api/plugins": {
            GET: () => json(pluginsSummary()),
        },
        "/api/capabilities": {
            GET: async () => {
                try {
                    return json(await capabilitiesCatalog());
                } catch (err) {
                    return jsonError(err, 500);
                }
            },
        },
        "/api/capabilities/toggle": {
            POST: async (req) => {
                try {
                    return json({ ok: true, capabilities: await toggleCapability(await readBody(req)) });
                } catch (err) {
                    return jsonError(err, 400);
                }
            },
        },
        "/api/capabilities/plugin": {
            POST: async (req) => {
                const body = await readBody(req);
                try {
                    const result = await installPlugin(body.manifest ?? body);
                    return json({ ok: true, name: result.name, path: result.path, capabilities: result.catalog });
                } catch (err) {
                    return jsonError(err, 400);
                }
            },
        },
        "/api/capabilities/plugin/remove": {
            POST: async (req) => {
                const body = await readBody(req);
                try {
                    return json({ ok: true, capabilities: await uninstallPlugin(typeof body.name === "string" ? body.name : "") });
                } catch (err) {
                    return jsonError(err, 400);
                }
            },
        },
        "/api/capabilities/skill": {
            POST: async (req) => {
                try {
                    const result = await installSkill(await readBody(req));
                    return json({ ok: true, name: result.name, path: result.path, capabilities: result.catalog });
                } catch (err) {
                    return jsonError(err, 400);
                }
            },
        },
        "/api/capabilities/skill/remove": {
            POST: async (req) => {
                const body = await readBody(req);
                try {
                    return json({ ok: true, capabilities: await uninstallSkill(typeof body.name === "string" ? body.name : "") });
                } catch (err) {
                    return jsonError(err, 400);
                }
            },
        },
        "/api/capabilities/apply": {
            POST: async () => {
                try {
                    return json({ ok: true, ...await applyCapabilities() });
                } catch (err) {
                    return jsonError(err, 409);
                }
            },
        },
        // The console's twin of `bun run plugins:list --check`. It starts each MCP plugin, so
        // it runs only when asked, never on page load.
        "/api/plugins/check": {
            POST: async () => {
                try {
                    return json({ ok: true, checks: await checkPlugins() });
                } catch (err) {
                    return json({ ok: false, error: errorMessage(err) }, 400);
                }
            },
        },
        "/api/databricks/connect": {
            POST: async (req) => {
                const input = await readBody(req);
                const oauth = input.oauth && typeof input.oauth === "object"
                    ? input.oauth as Record<string, unknown>
                    : undefined;

                try {
                    const status = await connectDatabricks({
                        profile: typeof input.profile === "string" ? input.profile : undefined,
                        host: typeof input.host === "string" ? input.host : undefined,
                        token: typeof input.token === "string" ? input.token : undefined,
                        warehouseId: typeof input.warehouseId === "string" ? input.warehouseId : undefined,
                        ...(oauth && typeof oauth.clientId === "string" && typeof oauth.clientSecret === "string"
                            ? {
                                oauth: {
                                    clientId: oauth.clientId,
                                    clientSecret: oauth.clientSecret,
                                    ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
                                },
                            }
                            : {}),
                    });
                    return json({ ok: true, status });
                } catch (err) {
                    const message = errorMessage(err);
                    recordDatabricksAuthError(message);
                    return json({ ok: false, error: message, status: getDatabricksUiStatus() }, 400);
                }
            },
        },
        "/api/databricks/reconnect": {
            POST: async () => {
                try {
                    return json({ ok: true, status: await reconnectDatabricks() });
                } catch (err) {
                    const message = errorMessage(err);
                    recordDatabricksAuthError(message);
                    return json({ ok: false, error: message, status: getDatabricksUiStatus() }, 400);
                }
            },
        },
        "/api/databricks/disconnect": {
            POST: async () => json({ ok: true, status: await disconnectDatabricks() }),
        },
        "/api/databricks/oauth/start": {
            POST: async (req) => {
                const input = await readBody(req);
                try {
                    const result = startBrowserOAuth({
                        host: typeof input.host === "string" ? input.host : undefined,
                    });
                    return json({ ok: true, ...result });
                } catch (err) {
                    const message = errorMessage(err);
                    recordDatabricksAuthError(message);
                    return json({ ok: false, error: message }, 400);
                }
            },
        },
        "/api/databricks/oauth/status": {
            GET: () => json(getOAuthFlow()),
        },
        "/api/databricks/oauth/cancel": {
            POST: () => {
                cancelBrowserOAuth();
                return json({ ok: true, ...getOAuthFlow() });
            },
        },

        "/prototype": indexHtml,
        "/prototype/agents": indexHtml,
        "/prototype/runs": indexHtml,
        "/prototype/data": indexHtml,
        "/prototype/capabilities": indexHtml,
        "/prototype/settings": indexHtml,
        "/": indexHtml,
    },
    development: {
        hmr: true,
        console: true,
    },
    error(error) {
        return jsonError(error);
    },
});

console.log("\n==========================================================");
console.log("  STILLWORK: DURABLE AGENT DATA PLATFORM");
console.log("==========================================================");
console.log(`\n  🚀 URL: http://localhost:${server.port}/prototype`);
console.log(`\n  Pages:`);
console.log(`  - Overview:     http://localhost:${server.port}/prototype`);
console.log(`  - Agents:       http://localhost:${server.port}/prototype/agents`);
console.log(`  - Durable runs: http://localhost:${server.port}/prototype/runs`);
console.log(`  - Data health:  http://localhost:${server.port}/prototype/data`);
console.log(`  - Capabilities: http://localhost:${server.port}/prototype/capabilities`);
console.log(`  - Settings:     http://localhost:${server.port}/prototype/settings`);
console.log(`  - Databricks:   http://localhost:${server.port}/api/databricks/status`);
console.log(`  - Main agent:   http://localhost:${server.port}/api/workspace`);
console.log("==========================================================\n");
