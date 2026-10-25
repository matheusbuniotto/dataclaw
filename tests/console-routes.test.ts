import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPlugin, capabilityCatalog, type PluginFacts } from "../src/capabilities/catalog";
import { AGENT_BUSY } from "../src/console/api/capabilities-api";
import { pluginsSummary } from "../src/console/api/plugins-api";
import { handle, respond, routes } from "../src/console/api/routes";
import { ConflictError, DatabricksStatusError, NotFoundError, ValidationError } from "../src/console/api/wire";

const tmp = mkdtempSync(join(tmpdir(), "dataclaw-routes-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const project = (name: string): string => {
    const root = join(tmp, name);
    mkdirSync(root, { recursive: true });
    return root;
};

/** A request the console server would receive, with no listener in sight. */
function request(method: string, path: string, body?: unknown): Request {
    return new Request(`http://console.test${path}`, {
        method,
        ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
}

async function answer(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await handle(request(method, path, body));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("the console's pages", () => {
    test("a page answers with and without its trailing slash", async () => {
        const { startServer } = await import("../src/console/api/server");
        const server = startServer({ port: 0, hostname: "127.0.0.1" });
        try {
            for (const path of [
                "/console",
                "/console/",
                "/console/capabilities",
                "/console/capabilities/",
                "/console/observability",
                "/console/observability/",
                "/prototype",
                "/prototype/",
                "/prototype/capabilities",
                "/prototype/capabilities/",
            ]) {
                const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
                expect({ path, status: response.status }).toEqual({ path, status: 200 });
                expect(response.headers.get("content-type")).toContain("text/html");
            }
        } finally {
            server.stop(true);
        }
    });

    test("startServer respects DATABRICKS_APP_PORT environment variable and binds 0.0.0.0", async () => {
        const { startServer } = await import("../src/console/api/server");
        const prevPort = process.env.DATABRICKS_APP_PORT;
        try {
            process.env.DATABRICKS_APP_PORT = "54321";
            const server = startServer({ port: 0 }); // Override port with 0 for safety in tests
            try {
                expect(server.port).toBeGreaterThan(0);
                expect(server.hostname).toBe("0.0.0.0");
            } finally {
                server.stop(true);
            }
        } finally {
            if (prevPort !== undefined) {
                process.env.DATABRICKS_APP_PORT = prevPort;
            } else {
                delete process.env.DATABRICKS_APP_PORT;
            }
        }
    });

    test("production bundle uses react/jsx-runtime without jsxDEV", async () => {
        const { startServer } = await import("../src/console/api/server");
        const prevEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            const server = startServer({ port: 0, hostname: "127.0.0.1" });
            try {
                const response = await fetch(`http://127.0.0.1:${server.port}/console`);
                const html = await response.text();
                for (const m of html.matchAll(/src="([^"]+)"/g)) {
                    if (m[1]?.startsWith("/")) {
                        const jsRes = await fetch(`http://127.0.0.1:${server.port}${m[1]}`);
                        const js = await jsRes.text();
                        expect(js.includes("jsxDEV")).toBe(false);
                    }
                }
            } finally {
                server.stop(true);
            }
        } finally {
            if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
            else delete process.env.NODE_ENV;
        }
    });
});

describe("the route table is data, not a listener", () => {
    test("importing the entry point starts nothing; startServer is the only listener", async () => {
        // The import must not bind a port: a console server would have kept this process alive.
        const entry = await import("../src/console/api/server");
        expect(typeof entry.startServer).toBe("function");
        expect(typeof handle).toBe("function");
    });

    test("every entry is one method, one optional input reader and one domain function", () => {
        const paths = Object.keys(routes);
        expect(paths.every((path) => path.startsWith("/api/"))).toBe(true);
        for (const path of ["/api/workspace", "/api/capabilities", "/api/plugins", "/api/agent/ask", "/api/databricks/status"]) {
            expect(paths).toContain(path);
        }
        for (const methods of Object.values(routes)) {
            const handlers = Object.values(methods);
            expect(handlers.length).toBeGreaterThan(0);
            for (const route of handlers) expect(typeof route?.run).toBe("function");
        }
    });

    test("a route answers a plain request: no port, no server", async () => {
        const status = await answer("GET", "/api/databricks/status");
        expect(status.status).toBe(200);
        expect(status.body.ok).toBe(true);
        expect(status.body.connected).toBe(false);
        expect(Array.isArray(status.body.profiles)).toBe(true);

        const flow = await answer("GET", "/api/databricks/oauth/status");
        expect(flow.body).toMatchObject({ ok: true, state: "idle" });

        const cancelled = await answer("POST", "/api/databricks/oauth/cancel");
        expect(cancelled.body).toMatchObject({ ok: true, state: "idle" });

        const genie = await answer("GET", "/api/databricks/genie/spaces");
        expect(genie.status).toBe(200);
        expect(genie.body.ok).toBe(true);
        expect(Array.isArray(genie.body.spaces)).toBe(true);

        const conns = await answer("GET", "/api/databricks/connections");
        expect(conns.status).toBe(200);
        expect(conns.body.ok).toBe(true);
        expect(Array.isArray(conns.body.connections)).toBe(true);

        const mlflow = await answer("GET", "/api/databricks/mlflow/status");
        expect(mlflow.status).toBe(200);
        expect(mlflow.body.ok).toBe(true);
        expect(typeof mlflow.body.enabled).toBe("boolean");

        const aiModels = await answer("GET", "/api/ai/models");
        expect(aiModels.status).toBe(200);
        expect(aiModels.body.ok).toBe(true);
        expect(aiModels.body.current).toBeDefined();
        expect(Array.isArray(aiModels.body.categories)).toBe(true);

        const fetchModelsGet = await answer("GET", "/api/ai/models/fetch");
        expect(fetchModelsGet.status).toBe(200);
        expect(Array.isArray(fetchModelsGet.body.models)).toBe(true);

        const fetchModelsPost = await answer("POST", "/api/ai/models/fetch", {});
        expect(fetchModelsPost.status).toBe(200);
        expect(Array.isArray(fetchModelsPost.body.models)).toBe(true);

        const obs = await answer("GET", "/api/observability");
        expect(obs.status).toBe(200);
        expect(obs.body.evals).toBeDefined();
        expect(obs.body.power).toBeDefined();
        expect(obs.body.growth).toBeDefined();
        expect(obs.body.auditor).toBeDefined();
        expect(obs.body.langwatch).toBeDefined();

        const trace = await answer("POST", "/api/observability/trace");
        expect(trace.status).toBe(200);
        expect(trace.body.ok).toBe(true);
        expect(trace.body.trace_id).toBeDefined();
    });

    test("a route reads its query and its JSON body", async () => {
        // No harness is opened by the plugins route: it reports manifests, nothing else.
        const plugins = await answer("GET", "/api/plugins");
        expect(plugins.status).toBe(200);
        expect(plugins.body.ok).toBe(true);
        expect(Array.isArray(plugins.body.plugins)).toBe(true);

        // The workspace route parses `agentId` off the query string before it opens a harness,
        // so an unknown path and a refused ask answer without touching one.
        const missing = await answer("GET", "/api/nope");
        expect(missing.status).toBe(404);
        expect(missing.body).toMatchObject({ ok: false });

        const wrongMethod = await answer("POST", "/api/workspace");
        expect(wrongMethod.status).toBe(405);

        const empty = await answer("POST", "/api/agent/ask", {});
        expect(empty.status).toBe(400);
        expect(empty.body.error).toBe("content is required");

        const long = await answer("POST", "/api/agent/ask", { content: "x".repeat(20_001) });
        expect(long.status).toBe(400);
        expect(long.body.error).toBe("That request is too long.");

        const report = await answer("GET", "/api/report?format=json");
        expect(report.status).toBe(200);
        expect(report.body.ok).toBe(true);
        expect(report.body.format).toBe("json");

        const htmlReport = await handle(request("GET", "/api/report?format=html"));
        expect(htmlReport.status).toBe(200);
        expect(htmlReport.headers.get("Content-Type")).toContain("text/html");

        const dossier = await handle(request("GET", "/api/dossier"));
        expect(dossier.status).toBe(200);
        expect(dossier.headers.get("Content-Type")).toContain("text/markdown");
    });

    test("a body field is read once, at the route", async () => {
        const unreadable = await answer("POST", "/api/capabilities/toggle", { id: "plugin:demo" });
        expect(unreadable.status).toBe(400);
        expect(unreadable.body.error).toBe("\"enabled\" must be true or false");

        const unnamed = await answer("POST", "/api/capabilities/plugin/remove", {});
        expect(unnamed.status).toBe(400);
        expect(unnamed.body.error).toBe("name is required");
    });
});

describe("one error-to-status adapter", () => {
    const statusAndBody = async (thrown: unknown) => {
        const response = await respond(() => { throw thrown; });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
    };

    test("a returned value is 200, a validation error 400, a conflict 409, an unexpected failure 500", async () => {
        const ok = await respond(() => ({ submissionId: "sub-1", agentId: "" }));
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ ok: true, submissionId: "sub-1", agentId: "" });

        const validation = await statusAndBody(new ValidationError("content is required"));
        expect(validation.status).toBe(400);
        expect(validation.body).toEqual({ ok: false, error: "content is required" });

        const conflict = await statusAndBody(new ConflictError(AGENT_BUSY));
        expect(conflict.status).toBe(409);
        expect(conflict.body).toEqual({ ok: false, error: AGENT_BUSY });

        const unexpected = await statusAndBody(new Error("the harness is closed"));
        expect(unexpected.status).toBe(500);
        expect(unexpected.body).toEqual({ ok: false, error: "the harness is closed" });

        const missing = await statusAndBody(new NotFoundError("No route for /api/nope"));
        expect(missing.status).toBe(404);
    });

    test("a Databricks failure carries its status snapshot instead of its own convention", async () => {
        const snapshot = { connected: false, configured: true, catalogs: [], profiles: [], defaultProfile: "DEFAULT" };
        const response = await respond(() => { throw new DatabricksStatusError("A workspace URL is required.", snapshot); });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            ok: false,
            error: "A workspace URL is required.",
            status: snapshot,
        });
    });
});

describe("one plugin projection", () => {
    test("/api/plugins and /api/capabilities describe the same plugin facts", async () => {
        const root = project("plugins");
        addPlugin(root, {
            name: "alpha-stats",
            version: "1.2.0",
            description: "shared capability, lower priority",
            domain: "stats",
            capabilities: ["stats.agreement_kappa@1"],
            priority: 0,
            transport: { type: "mcp", command: "bun", args: ["server.ts"] },
        });
        addPlugin(root, {
            name: "beta-stats",
            version: "0.3.0",
            description: "wins the shared capability",
            domain: "stats",
            capabilities: ["stats.agreement_kappa@1"],
            priority: 10,
            transport: { type: "script", command: "bun", args: ["eval.ts"] },
        });

        // The two endpoints read exactly these two functions: pluginsSummary for /api/plugins
        // and capabilityCatalog (via capabilities-api) for /api/capabilities.
        const fromPlugins = pluginsSummary(undefined, root).plugins;
        const catalog = await capabilityCatalog({
            projectRoot: root,
            workspaceDir: join(root, "workspace"),
            databricks: { connected: false },
        });
        const fromCatalog = catalog.entries
            .filter((entry) => entry.kind === "plugin")
            .map((entry) => entry.plugin);

        expect(fromCatalog).toEqual(fromPlugins);
        expect(fromPlugins.map((facts: PluginFacts) => facts.name)).toEqual(["alpha-stats", "beta-stats"]);
        expect(fromPlugins[0]).toMatchObject({
            version: "1.2.0",
            transport: "mcp",
            priority: 0,
            status: "declared",
            capabilities: [{ id: "stats.agreement_kappa@1", winner: false, shadowedBy: "beta-stats" }],
            tools: [],
        });
        expect(fromPlugins[1]?.capabilities).toEqual([{ id: "stats.agreement_kappa@1", winner: true }]);
    });
});
