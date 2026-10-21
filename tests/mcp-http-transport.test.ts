/**
 * The streamable-HTTP MCP transport: one wire for Databricks and for any data MCP a manifest
 * declares. These tests use a local MCP endpoint, not a real warehouse.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { validateManifest } from "../src/plugins/manifest";
import { expandEnv, openMcpPlugin, openPlugin } from "../src/plugins/transports";
import type { LoadedPlugin } from "../src/plugins/types";
import { HttpMcpClient } from "../src/mcp/http-mcp-client";

type Mode = "ok" | "tool-error" | "slow";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let mode: Mode = "ok";
const seenAuth: string[] = [];

function reply(id: unknown, result: unknown): Response {
    return Response.json({ jsonrpc: "2.0", id, result });
}

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
            const body = await req.json() as any;
            const id = body.id;
            const method = body.method;
            const auth = req.headers.get("authorization");
            if (auth) seenAuth.push(auth);

            if (method === "initialize") {
                return reply(id, {
                    protocolVersion: "2025-06-18",
                    capabilities: { tools: {} },
                    serverInfo: { name: "fake-data-mcp", version: "0.1.0" },
                });
            }
            if (method === "notifications/initialized") return new Response(null, { status: 202 });
            if (method === "tools/list") {
                return reply(id, {
                    tools: [
                        { name: "run_sql", description: "Run SQL", inputSchema: { type: "object" } },
                        { name: "describe_table", inputSchema: { type: "object" } },
                    ],
                });
            }
            if (method === "tools/call") {
                const name = body.params?.name;
                // A stale token fails at call time, not at connect: that is where a provider re-mints.
                if (auth === "Bearer stale") return new Response("401 Unauthorized", { status: 401 });
                if (mode === "slow") await Bun.sleep(150);
                if (mode === "tool-error") {
                    return reply(id, { isError: true, content: [{ type: "text", text: "warehouse exploded" }] });
                }
                if (name === "run_sql") {
                    return reply(id, {
                        structuredContent: { columns: ["a"], rows: [{ a: 1 }], rowCount: 1 },
                    });
                }
                if (name === "describe_table") {
                    return reply(id, {
                        content: [{ type: "text", text: JSON.stringify({ columns: [{ name: "a", type: "INTEGER" }] }) }],
                    });
                }
                return reply(id, { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] });
            }
            return new Response("Not Found", { status: 404 });
        },
    });
    baseUrl = `http://127.0.0.1:${server.port}/mcp`;
    process.env.MCP_TEST_URL = baseUrl;
    process.env.MCP_TEST_TOKEN = "ok";
});

afterAll(() => {
    server.stop(true);
    delete process.env.MCP_TEST_URL;
    delete process.env.MCP_TEST_TOKEN;
});

function plugin(transport: Record<string, unknown> = {}): LoadedPlugin {
    const manifest = validateManifest({
        name: "snowfake",
        version: "1.0.0",
        description: "A fake data MCP",
        domain: "data",
        capabilities: ["data.run_sql@1", "data.describe_table@1"],
        transport: { type: "mcp-http", url: "${MCP_TEST_URL}", bearerEnv: "MCP_TEST_TOKEN", ...transport },
    }, "/tmp/plugins/snowfake/plugin.json");
    return { manifest, source: "/tmp/plugins/snowfake/plugin.json", cwd: "/tmp/plugins/snowfake" };
}

describe("mcp-http manifest", () => {
    test("accepts url, headers and bearerEnv", () => {
        const loaded = plugin({ headers: { "X-Tenant": "acme" } });
        expect(loaded.manifest.transport.type).toBe("mcp-http");
    });

    test("rejects a process command next to an HTTP url", () => {
        expect(() => plugin({ command: "uvx" })).toThrow("transport.command is not used by mcp-http");
    });

    test("requires a url", () => {
        expect(() => plugin({ url: "" })).toThrow("transport.url must be a non-empty string");
    });

    test("expands an environment reference and fails loudly when it is missing", () => {
        expect(expandEnv("${MCP_TEST_URL}/v1", "test")).toBe(`${baseUrl}/v1`);
        expect(() => expandEnv("${MCP_TEST_MISSING}", "test")).toThrow("MCP_TEST_MISSING");
    });
});

describe("mcp-http plugin client", () => {
    test("opens the manifest's endpoint and lists the server's tools", async () => {
        const client = openMcpPlugin(plugin());
        expect(client).toBeDefined();
        try {
            expect(await client!.listTools()).toEqual(["describe_table", "run_sql"]);
            const definitions = await client!.listToolDefinitions();
            expect(definitions.map((definition) => definition.name)).toEqual(["run_sql", "describe_table"]);
        } finally {
            await client!.close();
        }
    });

    test("sends the bearer token from the environment", async () => {
        seenAuth.length = 0;
        const client = openMcpPlugin(plugin());
        try {
            await client!.listTools();
        } finally {
            await client!.close();
        }
        expect(seenAuth).toContain("Bearer ok");
    });

    test("maps a capability to its tool and reads structured content", async () => {
        const client = openMcpPlugin(plugin());
        try {
            const value = await client!.invoke("data.run_sql@1", { sql: "SELECT 1" });
            expect(value).toEqual({ columns: ["a"], rows: [{ a: 1 }], rowCount: 1 });
        } finally {
            await client!.close();
        }
    });

    test("reads a JSON text result", async () => {
        const client = openMcpPlugin(plugin());
        try {
            const value = await client!.invoke("data.describe_table@1", { table: "t" });
            expect(value).toEqual({ columns: [{ name: "a", type: "INTEGER" }] });
        } finally {
            await client!.close();
        }
    });

    test("turns a tool error into a PluginError naming the plugin", async () => {
        mode = "tool-error";
        const client = openMcpPlugin(plugin());
        try {
            await expect(client!.invoke("data.run_sql@1", { sql: "SELECT 1" }))
                .rejects.toThrow("snowfake");
        } finally {
            mode = "ok";
            await client!.close();
        }
    });

    test("openPlugin picks the HTTP client for an mcp-http manifest", () => {
        expect(openPlugin(plugin()).constructor.name).toBe("McpHttpPluginClient");
    });
});

describe("HttpMcpClient auth and cancellation", () => {
    test("re-mints the token once after an auth failure", async () => {
        let token = "stale";
        const seen: string[] = [];
        const http = await HttpMcpClient.connect({
            url: baseUrl,
            tokenProvider: (force) => {
                if (force) token = "fresh";
                seen.push(token);
                return token;
            },
        });
        // The fake server accepts any token except "stale", so the second attempt must carry the new one.
        const value = await http.callTool("run_sql", { sql: "SELECT 1" });
        expect(value.structuredContent).toEqual({ columns: ["a"], rows: [{ a: 1 }], rowCount: 1 });
        expect(seen).toEqual(["stale", "fresh"]);
        await http.close();
    });

    test("stops a call when the signal aborts", async () => {
        mode = "slow";
        const http = await HttpMcpClient.connect({ url: baseUrl });
        const controller = new AbortController();
        const call = http.callTool("run_sql", { sql: "SELECT 1" }, { signal: controller.signal });
        setTimeout(() => controller.abort(), 10);
        await expect(call).rejects.toThrow("Stopped.");
        mode = "ok";
        await http.close();
    });

    test("names the server's real tools when one is missing", async () => {
        const http = await HttpMcpClient.connect({ url: baseUrl });
        await expect(http.callTool("nope", {})).rejects.toThrow("describe_table, run_sql");
        await http.close();
    });
});
