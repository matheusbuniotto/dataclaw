import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDatabricksCfg, resolveDatabricksConfig, listDatabricksProfiles } from "../src/mcp/databricks-config";
import {
    decodeSqlValue,
    isReadOnlySql,
    McpSqlClient,
    normalizeStatementResult,
    quoteQualifiedName,
    splitQualifiedName,
} from "../src/mcp/mcp-sql-client";
import {
    buildAuthorizeUrl,
    DatabricksOAuthError,
    DatabricksOAuthSession,
    exchangeAuthorizationCode,
    generatePkcePair,
} from "../src/mcp/databricks-oauth";

describe("Databricks configuration", () => {
    test("reads profiles from DATABRICKS_CONFIG_FILE and derives the managed MCP URL", async () => {
        const dir = mkdtempSync(join(tmpdir(), "dataclaw-databricks-"));
        const configFile = join(dir, ".databrickscfg");
        writeFileSync(
            configFile,
            [
                "[DEFAULT]",
                "host = https://dbc-test.cloud.databricks.com",
                "token = dapi-test",
                "",
                "[other]",
                "host = other.cloud.databricks.com",
                "",
            ].join("\n"),
        );

        const previous = process.env.DATABRICKS_CONFIG_FILE;
        const envKeys = [
            "DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_PROFILE",
            "DATABRICKS_MCP_URL", "DATABRICKS_WAREHOUSE_ID",
        ] as const;
        const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
        for (const key of envKeys) delete process.env[key];
        process.env.DATABRICKS_CONFIG_FILE = configFile;
        try {
            expect(readDatabricksCfg("DEFAULT").host).toBe("https://dbc-test.cloud.databricks.com");
            expect(readDatabricksCfg("other").host).toBe("other.cloud.databricks.com");

            const config = resolveDatabricksConfig({ profile: "DEFAULT" });
            expect(config.host).toBe("https://dbc-test.cloud.databricks.com");
            expect(config.url).toBe("https://dbc-test.cloud.databricks.com/api/2.0/mcp/sql");
            expect(config.token).toBe("dapi-test");
            expect(config.readOnly).toBe(true);

            const profiles = listDatabricksProfiles();
            expect(profiles.map((profile) => profile.name)).toEqual(["DEFAULT", "other"]);
            expect(profiles[0]?.host).toBe("https://dbc-test.cloud.databricks.com");
            expect(profiles[0]?.hasToken).toBe(true);

            const { getDatabricksUiStatus } = await import("../src/prototype/databricks-api");
            const status = getDatabricksUiStatus();
            expect(status.connected).toBe(false);
            expect(status.configured).toBe(true);
            expect(status.host).toBe("https://dbc-test.cloud.databricks.com");
            expect(status.authMethod).toBe("config");
        } finally {
            if (previous === undefined) delete process.env.DATABRICKS_CONFIG_FILE;
            else process.env.DATABRICKS_CONFIG_FILE = previous;
            for (const key of envKeys) {
                const value = savedEnv[key];
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });
});

describe("Databricks OAuth", () => {
    let server: ReturnType<typeof Bun.serve>;
    let baseUrl: string;
    let requests: URLSearchParams[] = [];
    let authHeaders: Array<string | undefined> = [];

    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            async fetch(req) {
                const url = new URL(req.url);
                if (!url.pathname.endsWith("/oidc/v1/token")) {
                    return new Response("not found", { status: 404 });
                }
                if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

                const body = new URLSearchParams(await req.text());
                requests.push(body);
                authHeaders.push(req.headers.get("authorization") ?? undefined);

                const grant = body.get("grant_type");
                if (grant === "authorization_code") {
                    if (body.get("code") === "bad-code") {
                        return Response.json(
                            { error: "invalid_grant", error_description: "Authorization code is invalid" },
                            { status: 400 },
                        );
                    }
                    return Response.json({
                        access_token: "u2m-token-1",
                        refresh_token: "refresh-1",
                        expires_in: 3600,
                        scope: "offline_access sql",
                    });
                }
                if (grant === "refresh_token") {
                    return Response.json({
                        access_token: "u2m-token-2",
                        refresh_token: "refresh-2",
                        expires_in: 3600,
                    });
                }
                if (grant === "client_credentials") {
                    if (req.headers.get("authorization") !== `Basic ${btoa("client-id:client-secret")}`) {
                        return Response.json({ error: "invalid_client" }, { status: 401 });
                    }
                    return Response.json({ access_token: "m2m-token-1", expires_in: 3600, scope: "sql" });
                }
                return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
            },
        });
        baseUrl = `http://127.0.0.1:${server.port}`;
    });

    afterAll(() => {
        server.stop(true);
    });

    test("builds a PKCE authorize URL matching the Databricks CLI client", () => {
        const { verifier, challenge } = generatePkcePair();
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        expect(challenge).not.toBe(verifier);

        const url = new URL(buildAuthorizeUrl({
            host: "dbc-test.cloud.databricks.com",
            state: "state-123",
            codeChallenge: challenge,
        }));
        expect(url.origin).toBe("https://dbc-test.cloud.databricks.com");
        expect(url.pathname).toBe("/oidc/v1/authorize");
        expect(url.searchParams.get("client_id")).toBe("databricks-cli");
        expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8020");
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("scope")).toBe("offline_access sql");
        expect(url.searchParams.get("state")).toBe("state-123");
    });

    test("exchanges an authorization code and refreshes the session", async () => {
        requests = [];
        const tokens = await exchangeAuthorizationCode({
            host: baseUrl,
            code: "good-code",
            codeVerifier: "verifier-123",
        });
        expect(tokens.accessToken).toBe("u2m-token-1");
        expect(tokens.refreshToken).toBe("refresh-1");
        expect(requests[0]?.get("code_verifier")).toBe("verifier-123");
        expect(requests[0]?.get("redirect_uri")).toBe("http://localhost:8020");
        expect(requests[0]?.get("client_id")).toBe("databricks-cli");

        const session = await DatabricksOAuthSession.fromAuthorizationCode({
            host: baseUrl,
            code: "good-code",
            codeVerifier: "verifier-123",
        });
        expect(await session.getAccessToken()).toBe("u2m-token-1");
        await session.refresh();
        expect(await session.getAccessToken()).toBe("u2m-token-2");
        expect(requests.some((body) => body.get("grant_type") === "refresh_token")).toBe(true);
    });

    test("requests a service-principal token with client credentials", async () => {
        requests = [];
        authHeaders = [];
        const session = await DatabricksOAuthSession.fromClientCredentials({
            host: baseUrl,
            clientId: "client-id",
            clientSecret: "client-secret",
        });
        expect(session.oauthMode).toBe("m2m");
        expect(await session.getAccessToken()).toBe("m2m-token-1");
        expect(authHeaders[0]).toBe(`Basic ${btoa("client-id:client-secret")}`);
        expect(requests[0]?.get("grant_type")).toBe("client_credentials");
        expect(requests[0]?.get("scope")).toBe("sql");
    });

    test("surfaces OAuth error descriptions", async () => {
        await expect(exchangeAuthorizationCode({
            host: baseUrl,
            code: "bad-code",
            codeVerifier: "verifier-123",
        })).rejects.toThrow(DatabricksOAuthError);
        await expect(exchangeAuthorizationCode({
            host: baseUrl,
            code: "bad-code",
            codeVerifier: "verifier-123",
        })).rejects.toThrow("Authorization code is invalid");
    });
});

describe("SQL safety", () => {
    test("accepts read-only statements", () => {
        expect(isReadOnlySql("SELECT * FROM samples.nyctaxi.trips")).toBe(true);
        expect(isReadOnlySql("  with x as (select 1) select * from x")).toBe(true);
        expect(isReadOnlySql("SHOW CATALOGS")).toBe(true);
        expect(isReadOnlySql("DESCRIBE TABLE main.default.t")).toBe(true);
        expect(isReadOnlySql("-- comment\nSELECT 1")).toBe(true);
    });

    test("rejects mutations, including hidden in comments-free multi statements", () => {
        expect(isReadOnlySql("DELETE FROM main.default.t")).toBe(false);
        expect(isReadOnlySql("SELECT 1; DROP TABLE main.default.t")).toBe(false);
        expect(isReadOnlySql("SELECT * FROM t;")).toBe(true);
        expect(isReadOnlySql("CREATE TABLE x AS SELECT 1")).toBe(false);
        expect(isReadOnlySql("SELECT 'DROP TABLE x' AS note")).toBe(true);
        expect(isReadOnlySql("SELECT `delete` FROM t")).toBe(true);
        expect(isReadOnlySql("SELECT replace(city, 'a', 'b') FROM t")).toBe(true);
        expect(isReadOnlySql("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x")).toBe(false);
    });
});

describe("qualified identifiers", () => {
    test("quotes every part", () => {
        expect(quoteQualifiedName("samples.nyctaxi.trips")).toBe("`samples`.`nyctaxi`.`trips`");
        expect(quoteQualifiedName("`my-catalog`.`my.schema`.tbl")).toBe("`my-catalog`.`my.schema`.`tbl`");
        expect(splitQualifiedName("a.b.c")).toEqual(["a", "b", "c"]);
    });

    test("rejects injection attempts", () => {
        expect(() => quoteQualifiedName("a.b;DROP TABLE c")).toThrow();
        expect(() => quoteQualifiedName("a..c")).toThrow();
        expect(() => quoteQualifiedName("a.`unbalanced")).toThrow();
    });
});

describe("statement result normalization", () => {
    test("decodes classic data_array values", () => {
        const normalized = normalizeStatementResult({
            statement_id: "stmt-1",
            status: { state: "SUCCEEDED" },
            manifest: {
                schema: {
                    columns: [
                        { name: "id", type_name: "BIGINT" },
                        { name: "city", type_name: "STRING" },
                        { name: "fare", type_name: "DOUBLE" },
                        { name: "active", type_name: "BOOLEAN" },
                    ],
                },
                total_row_count: 1,
            },
            result: {
                data_array: [{
                    values: [
                        { long_value: "7" },
                        { string_value: "Lisbon" },
                        { double_value: 12.5 },
                        { boolean_value: true },
                    ],
                }],
            },
        });

        expect(normalized.columns.map((column) => column.name)).toEqual(["id", "city", "fare", "active"]);
        expect(normalized.rowCount).toBe(1);
        expect(normalized.rows[0]).toEqual({ id: 7, city: "Lisbon", fare: 12.5, active: true });
        expect(normalized.truncated).toBe(false);
    });

    test("decodes typed PROTOBUF arrays and coerces numerics by column type", () => {
        const normalized = normalizeStatementResult({
            status: { state: "SUCCEEDED" },
            manifest: {
                schema: {
                    columns: [
                        { name: "one", type_name: "INT" },
                        { name: "ratio", type_name: "DOUBLE" },
                        { name: "label", type_name: "STRING" },
                    ],
                },
                total_row_count: 3,
            },
            result: {
                data_typed_array: [{
                    values: [{ str: "1" }, { f64: 0.5 }, { str: "ok" }],
                }],
            },
        });

        expect(normalized.rows[0]).toEqual({ one: 1, ratio: 0.5, label: "ok" });
        expect(normalized.truncated).toBe(true); // 3 total rows, 1 returned
    });

    test("handles nulls and large integers", () => {
        expect(decodeSqlValue({ null: true })).toBeNull();
        expect(decodeSqlValue({ long_value: "9007199254740993" })).toBe("9007199254740993");
        expect(decodeSqlValue({ string_value: "x" })).toBe("x");
    });
});

// ---------------------------------------------------------------------------
// End-to-end against a mock Databricks-managed SQL MCP server.
// ---------------------------------------------------------------------------

const DESCRIBE_ROWS = [
    { col_name: "id", data_type: "BIGINT" },
    { col_name: "city", data_type: "STRING" },
    { col_name: "fare", data_type: "DOUBLE" },
    { col_name: "ts", data_type: "TIMESTAMP" },
];

const AGGREGATE_ROW = {
    __row_count: 4,
    c0__non_null: 4, c0__distinct: 4, c0__min: 1, c0__max: 4, c0__mean: 2.5, c0__median: 2.5,
    c1__non_null: 4, c1__distinct: 2,
    c2__non_null: 3, c2__distinct: 3, c2__min: 10, c2__max: 30, c2__mean: 20, c2__median: 20,
    c3__non_null: 4, c3__min: "2024-01-01T00:00:00Z", c3__max: "2024-01-04T00:00:00Z",
};

const SAMPLE_ROWS = [
    { id: 1, city: "Lisbon", fare: 10, ts: "2024-01-01T00:00:00Z" },
    { id: 2, city: "Porto", fare: 20, ts: "2024-01-02T00:00:00Z" },
    { id: 3, city: "Lisbon", fare: 30, ts: "2024-01-03T00:00:00Z" },
    { id: 4, city: "Lisbon", fare: null, ts: "2024-01-04T00:00:00Z" },
];

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
    state = "SUCCEEDED",
) {
    return {
        statement_id: `stmt-${Math.random().toString(16).slice(2)}`,
        status: { state },
        manifest: {
            format: "JSON_ARRAY",
            schema: {
                column_count: columns.length,
                columns: columns.map((column, index) => ({
                    name: column.name,
                    type_name: column.type,
                    type_text: column.type,
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

interface MockServerState {
    pending: Map<string, { columns: Array<{ name: string; type: string }>; rows: Array<Record<string, unknown>> }>;
}

function toolResult(payload: unknown) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError: false,
    };
}

describe("McpSqlClient + DatabricksDataAdapter over streamable HTTP", () => {
    let server: ReturnType<typeof Bun.serve>;
    let state: MockServerState;
    let baseUrl: string;

    beforeAll(() => {
        state = { pending: new Map() };

        server = Bun.serve({
            port: 0,
            async fetch(req) {
                if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

                const body = await req.json() as any;
                const id = body.id;
                const method = body.method;

                const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });

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
                if (method === "tools/call") {
                    const name = body.params?.name;
                    const args = body.params?.arguments ?? {};

                    if (req.headers.get("authorization") === "Bearer stale-token") {
                        return new Response("401 Unauthorized", { status: 401 });
                    }
                    if (name === "execute_sql_read_only") {
                        const query = String(args.query);

                        if (/^DESCRIBE TABLE/i.test(query)) {
                            return reply(toolResult(statementPayload(
                                [{ name: "col_name", type: "STRING" }, { name: "data_type", type: "STRING" }],
                                DESCRIBE_ROWS,
                            )));
                        }
                        if (/COUNT\(\*\)/i.test(query)) {
                            return reply(toolResult(statementPayload(
                                Object.keys(AGGREGATE_ROW).map((key) => ({
                                    name: key,
                                    type: key.includes("__row_count") || key.includes("distinct") || key.includes("non_null") ? "BIGINT" : "DOUBLE",
                                })),
                                [AGGREGATE_ROW],
                            )));
                        }
                        if (/PERCENTILE_APPROX/i.test(query)) {
                            return reply(toolResult(statementPayload(
                                [
                                    { name: "n", type: "BIGINT" },
                                    { name: "p25", type: "DOUBLE" },
                                    { name: "p50", type: "DOUBLE" },
                                    { name: "p75", type: "DOUBLE" },
                                    { name: "p90", type: "DOUBLE" },
                                    { name: "p99", type: "DOUBLE" },
                                ],
                                [{ n: 4, p25: 10, p50: 20, p75: 25, p90: 30, p99: 35 }],
                            )));
                        }
                        if (/LIMIT 5/i.test(query)) {
                            return reply(toolResult(statementPayload(
                                [
                                    { name: "id", type: "BIGINT" },
                                    { name: "city", type: "STRING" },
                                    { name: "fare", type: "DOUBLE" },
                                    { name: "ts", type: "STRING" },
                                ],
                                SAMPLE_ROWS,
                            )));
                        }

                        const statementId = `pending-${state.pending.size + 1}`;
                        state.pending.set(statementId, {
                            columns: [{ name: "id", type: "BIGINT" }, { name: "city", type: "STRING" }],
                            rows: [{ id: 1, city: "Lisbon" }, { id: 2, city: "Porto" }],
                        });
                        return reply(toolResult({
                            statement_id: statementId,
                            status: { state: "PENDING" },
                            message: "SQL execution in progress",
                        }));
                    }

                    if (name === "poll_sql_result") {
                        const statementId = String(args.statement_id);
                        const pending = state.pending.get(statementId);
                        if (!pending) throw new Error(`Unknown statement ${statementId}`);
                        return reply(toolResult(statementPayload(pending.columns, pending.rows)));
                    }
                }

                return Response.json({
                    jsonrpc: "2.0",
                    id,
                    error: { code: -32601, message: `Unsupported method ${method}` },
                });
            },
        });

        baseUrl = `http://127.0.0.1:${server.port}/api/2.0/mcp/sql`;
    });

    afterAll(() => {
        server.stop(true);
    });

    function config() {
        return {
            url: baseUrl,
            host: "https://mock.cloud.databricks.com",
            token: "test-token",
            timeoutMs: 10_000,
            readOnly: true,
        };
    }

    test("stops polling when the abort signal fires", async () => {
        const client = await McpSqlClient.connect(config(), { clientName: "dataclaw-test" });
        const controller = new AbortController();
        const pending = client.execute("SELECT id, city FROM main.default.trips", {
            signal: controller.signal,
            pollIntervalMs: 30_000,
        });
        controller.abort();
        await expect(Promise.race([
            pending,
            new Promise((_, reject) => setTimeout(() => reject(new Error("still running")), 1000)),
        ])).rejects.toThrow("Stopped.");
        const next = await client.execute("SELECT id, city FROM main.default.trips", { pollIntervalMs: 10 });
        expect(next.rows).toEqual([{ id: 1, city: "Lisbon" }, { id: 2, city: "Porto" }]);
        await client.close();
    });

    test("polls pending statements to completion", async () => {
        const client = await McpSqlClient.connect(config(), { clientName: "dataclaw-test" });
        try {
            const result = await client.execute("SELECT id, city FROM main.default.trips", { pollIntervalMs: 10 });
            expect(result.rows).toEqual([{ id: 1, city: "Lisbon" }, { id: 2, city: "Porto" }]);
            expect(result.rowCount).toBe(2);
            expect(result.state).toBe("SUCCEEDED");
        } finally {
            await client.close();
        }
    });

    test("profiles a Unity Catalog table", async () => {
        const { DatabricksDataAdapter } = await import("../src/adapters/databricks-adapter");
        const adapter = await DatabricksDataAdapter.connect(
            { url: baseUrl, host: "https://mock.cloud.databricks.com", token: "test-token", timeoutMs: 10_000 },
            { defaultTable: "main.default.trips" },
        );

        try {
            const profile = await adapter.profile("main.default.trips");
            expect(profile.rowCount).toBe(4);
            expect(profile.columnCount).toBe(4);

            const id = profile.columns.find((column) => column.name === "id");
            expect(id?.type).toBe("INTEGER");
            expect(id?.nullCount).toBe(0);
            expect(id?.distinctCount).toBe(4);
            expect(id?.mean).toBe(2.5);

            const city = profile.columns.find((column) => column.name === "city");
            expect(city?.type).toBe("TEXT");
            expect(city?.distinctCount).toBe(2);
            expect(city?.sampleValues).toEqual(["Lisbon", "Porto"]);

            const fare = profile.columns.find((column) => column.name === "fare");
            expect(fare?.type).toBe("REAL");
            expect(fare?.nullCount).toBe(1);
            expect(fare?.nullPct).toBe(25);

            const ts = profile.columns.find((column) => column.name === "ts");
            expect(ts?.min).toBe("2024-01-01T00:00:00Z");
            expect(ts?.max).toBe("2024-01-04T00:00:00Z");
        } finally {
            await adapter.close();
        }
    });

    test("queries are read-only and metrics use Databricks SQL functions", async () => {
        const { DatabricksDataAdapter } = await import("../src/adapters/databricks-adapter");
        const adapter = await DatabricksDataAdapter.connect(
            { url: baseUrl, host: "https://mock.cloud.databricks.com", token: "test-token" },
            { defaultTable: "main.default.trips" },
        );

        try {
            await expect(adapter.query("DROP TABLE main.default.trips")).rejects.toThrow();
            await expect(adapter.query("DELETE FROM main.default.trips")).rejects.toThrow();

            const percentiles = await adapter.calculateMetric("percentiles", { col: "fare" });
            expect(percentiles.column).toBe("fare");
            expect(percentiles.count).toBe(4);
        } finally {
            await adapter.close();
        }
    });

    test("reconnects with a fresh token after a 401", async () => {
        const client = await McpSqlClient.connect(
            { ...config(), token: "stale-token" },
            { tokenFactory: () => "fresh-token" },
        );
        try {
            const result = await client.execute("SELECT id, city FROM main.default.trips", { pollIntervalMs: 10 });
            expect(result.rows.length).toBeGreaterThan(0);
        } finally {
            await client.close();
        }
    });
});
