import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/**
 * End-to-end browser OAuth flow against a mock Databricks workspace:
 *   authorize URL -> localhost callback -> token exchange -> managed SQL MCP -> status.
 */

function toClassicValue(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined) return { null: true };
    if (typeof value === "number") {
        return Number.isInteger(value) ? { long_value: String(value) } : { double_value: value };
    }
    if (typeof value === "boolean") return { boolean_value: value };
    return { string_value: String(value) };
}

function statementPayload(
    columns: Array<{ name: string; type: string }>,
    rows: Array<Record<string, unknown>>,
) {
    return {
        statement_id: `stmt-${Math.random().toString(16).slice(2)}`,
        status: { state: "SUCCEEDED" },
        manifest: {
            format: "JSON_ARRAY",
            schema: {
                column_count: columns.length,
                columns: columns.map((column, index) => ({
                    name: column.name,
                    type_name: column.type,
                    position: index,
                })),
            },
            total_chunk_count: 1,
            total_row_count: rows.length,
            truncated: false,
        },
        result: {
            chunk_index: 0,
            row_offset: 0,
            row_count: rows.length,
            data_array: rows.map((row) => ({
                values: columns.map((column) => toClassicValue(row[column.name])),
            })),
        },
    };
}

function toolResult(payload: unknown) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError: false,
    };
}

describe("Databricks browser OAuth flow", () => {
    let workspace: ReturnType<typeof Bun.serve>;
    let baseUrl: string;
    let tokenRequests = 0;

    beforeAll(() => {
        workspace = Bun.serve({
            port: 0,
            async fetch(req) {
                const url = new URL(req.url);

                if (url.pathname === "/oidc/v1/token") {
                    tokenRequests += 1;
                    const body = new URLSearchParams(await req.text());
                    if (body.get("grant_type") !== "authorization_code") {
                        return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
                    }
                    return Response.json({
                        access_token: "mock-oauth-access-token",
                        refresh_token: "mock-refresh-token",
                        expires_in: 3600,
                        scope: "offline_access sql",
                    });
                }

                if (url.pathname === "/api/2.0/mcp/sql") {
                    if (req.method !== "POST") {
                        return new Response("method not allowed", { status: 405 });
                    }
                    const body = (await req.json()) as any;
                    const method = body.method;
                    const reply = (result: unknown) =>
                        Response.json({ jsonrpc: "2.0", id: body.id, result });

                    if (method === "initialize") {
                        return reply({
                            protocolVersion: "2025-06-18",
                            capabilities: { tools: {} },
                            serverInfo: { name: "mock-dbsql", version: "0.1.0" },
                        });
                    }
                    if (method === "notifications/initialized") {
                        return new Response(null, { status: 202 });
                    }
                    if (method === "tools/list") {
                        return reply({
                            tools: [
                                { name: "execute_sql", inputSchema: { type: "object" } },
                                { name: "execute_sql_read_only", inputSchema: { type: "object" } },
                                { name: "poll_sql_result", inputSchema: { type: "object" } },
                            ],
                        });
                    }
                    if (method === "tools/call" && body.params?.name === "execute_sql_read_only") {
                        const query = String(body.params?.arguments?.query ?? "");
                        if (/SHOW CATALOGS/i.test(query)) {
                            return reply(toolResult(statementPayload(
                                [{ name: "catalog", type: "STRING" }],
                                [{ catalog: "samples" }, { catalog: "workspace" }],
                            )));
                        }
                        if (/current_user/i.test(query)) {
                            return reply(toolResult(statementPayload(
                                [{ name: "current_user", type: "STRING" }],
                                [{ current_user: "oauth@example.com" }],
                            )));
                        }
                        return reply(toolResult(statementPayload([], [])));
                    }
                }

                return new Response("not found", { status: 404 });
            },
        });
        baseUrl = `http://127.0.0.1:${workspace.port}`;
    });

    afterAll(() => {
        workspace.stop(true);
    });

    test("completes U2M sign-in and connects the MCP session", async () => {
        const api = await import("../src/console/api/databricks-api");
        await api.resetDatabricksConnection();

        const start = api.startBrowserOAuth({ host: baseUrl, port: 0 });
        const authorize = new URL(start.authorizeUrl);
        const state = authorize.searchParams.get("state");
        expect(state).toBeTruthy();
        expect(authorize.searchParams.get("client_id")).toBe("databricks-cli");
        expect(authorize.searchParams.get("redirect_uri")).toBe(`http://localhost:${start.port}`);

        const callbackUrl = `http://127.0.0.1:${start.port}/?code=mock-code&state=${encodeURIComponent(state!)}`;

        // A probe must not consume the one-time authorization code.
        const head = await fetch(callbackUrl, { method: "HEAD" });
        expect(head.status).toBe(204);

        const callback = await fetch(callbackUrl);
        expect(callback.status).toBe(200);
        expect(tokenRequests).toBe(1);

        // Refreshing or retrying the callback must not exchange the code twice.
        const duplicate = await fetch(callbackUrl).catch(() => undefined);
        if (duplicate) {
            expect(duplicate.status).toBe(200);
            expect(await duplicate.text()).toContain("already connected");
            expect(tokenRequests).toBe(1);
        } else {
            // The listener may already have shut down after success; that is fine.
            expect(tokenRequests).toBe(1);
        }

        const flow = api.getOAuthFlow();
        expect(flow.state).toBe("success");

        const status = api.getDatabricksUiStatus();
        expect(status.connected).toBe(true);
        expect(status.authMethod).toBe("oauth");
        expect(status.oauthMode).toBe("u2m");
        expect(status.user).toBe("oauth@example.com");
        expect(status.catalogs).toEqual(["samples", "workspace"]);

        await api.resetDatabricksConnection();
    });
});
