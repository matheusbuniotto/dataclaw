/**
 * The Databricks provider: the managed SQL MCP endpoint behind the provider port, run against a
 * local MCP server. It passes the same conformance suite as the fake warehouse, then serves a
 * session end to end.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DatabricksMcpConfig } from "../src/mcp/databricks-config";
import { DataSourceCatalog } from "../src/datasource/catalog";
import { DataSourceRegistry, type SourceRecordStore } from "../src/datasource/session";
import { openDatabricksProvider } from "../src/datasource/providers/databricks";
import { SourceError, type SourceRecord } from "../src/datasource/types";
import { providerConformance, type ProviderHarness, type ProviderScenario } from "./fixtures/providers/conformance";

type Mode = "ok" | "slow" | "error";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let deadUrl: string;
let mode: Mode = "ok";
const seen: string[] = [];

function statement(columns: Array<{ name: string; type: string }>, rows: unknown[][]): unknown {
    return {
        statement_id: "statement-1",
        status: { state: "SUCCEEDED" },
        manifest: {
            schema: { columns },
            total_row_count: rows.length,
            total_chunk_count: 1,
        },
        result: { data_array: rows },
    };
}

function payloadFor(sql: string): unknown {
    if (/^DESCRIBE TABLE/i.test(sql)) {
        return statement(
            [{ name: "col_name", type: "STRING" }, { name: "data_type", type: "STRING" }],
            [["id", "BIGINT"], ["amount", "DOUBLE"], ["placed_at", "TIMESTAMP"]],
        );
    }
    if (/__row_count/i.test(sql)) {
        return statement(
            [
                { name: "__row_count", type: "BIGINT" },
                { name: "c0__non_null", type: "BIGINT" },
                { name: "c0__distinct", type: "BIGINT" },
                { name: "c0__min", type: "DOUBLE" },
                { name: "c0__max", type: "DOUBLE" },
                { name: "c0__mean", type: "DOUBLE" },
                { name: "c0__median", type: "DOUBLE" },
            ],
            [[3, 3, 3, 10, 20, 15, 15]],
        );
    }
    return statement([{ name: "n", type: "BIGINT" }], [[1]]);
}

beforeAll(async () => {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
            const body = await req.json() as any;
            const id = body.id;
            const method = body.method;
            const auth = req.headers.get("authorization") ?? "";

            const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });

            if (method === "initialize") {
                return reply({
                    protocolVersion: "2025-06-18",
                    capabilities: { tools: {} },
                    serverInfo: { name: "mock-databricks", version: "0.1.0" },
                });
            }
            if (method === "notifications/initialized") return new Response(null, { status: 202 });
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
                if (auth === "Bearer expired") return new Response("401 Unauthorized", { status: 401 });
                if (auth === "Bearer denied") return new Response("403 Forbidden", { status: 403 });
                if (mode === "slow") await Bun.sleep(150);
                if (mode === "error") {
                    return reply({ isError: true, content: [{ type: "text", text: "table not found" }] });
                }
                const sql = String(body.params?.arguments?.query ?? "");
                seen.push(sql);
                return reply({ structuredContent: payloadFor(sql), isError: false });
            }
            return new Response("Not Found", { status: 404 });
        },
    });
    baseUrl = `http://127.0.0.1:${server.port}/api/2.0/mcp/sql`;

    const discarded = Bun.serve({ port: 0, fetch: () => new Response("nope") });
    deadUrl = `http://127.0.0.1:${discarded.port}/api/2.0/mcp/sql`;
    discarded.stop(true);
});

afterAll(() => {
    server.stop(true);
});

function config(url: string, token: string): DatabricksMcpConfig {
    return { url, host: "http://fake", token, timeoutMs: 2_000, readOnly: true };
}

async function create(scenario: ProviderScenario): Promise<ProviderHarness> {
    const token = scenario === "auth-expired" ? "expired" : scenario === "auth-denied" ? "denied" : "ok";
    mode = scenario === "slow" ? "slow" : scenario === "server-error" ? "error" : "ok";
    seen.length = 0;
    const provider = await openDatabricksProvider(
        { provider: "databricks" },
        {
            resolve: () => config(scenario === "unreachable" ? deadUrl : baseUrl, token),
            tokenFactory: () => token,
        },
    );
    return {
        provider,
        executed: seen,
        capabilities: { describe: false, inventory: false, profile: false },
        close: () => provider.close(),
    };
}

providerConformance("databricks", create);

describe("Databricks through the catalog and the session", () => {
    class MemoryStore implements SourceRecordStore {
        record?: SourceRecord;
        async read() { return this.record; }
        async write(record: SourceRecord) { this.record = record; }
        async clear() { this.record = undefined; }
    }

    function session() {
        mode = "ok";
        const store = new MemoryStore();
        const catalog = new DataSourceCatalog({
            projectRoot: "/tmp/dataclaw-test",
            plugins: [],
            databricks: { resolve: () => config(baseUrl, "ok"), tokenFactory: () => "ok" },
        });
        const registry = new DataSourceRegistry({ catalog, storeFor: () => store, reconnectCooldownMs: 0 });
        return { session: registry.for(1), store, catalog };
    }

    test("the catalog lists Databricks and opens it", async () => {
        const { catalog } = session();
        expect(catalog.list().map((provider) => provider.id)).toEqual(["databricks"]);
        const provider = await catalog.open({ provider: "databricks" });
        expect(provider.dialect.id).toBe("databricks");
        expect(provider.kind).toBe("remote");
        await provider.close();
    });

    test("connects, profiles with the dialect, and queries", async () => {
        const { session: live, store } = session();
        const record = await live.connect({ provider: "databricks" });

        expect(record).toMatchObject({ provider: "databricks", dialect: "databricks", endpoint: baseUrl });
        expect(store.record).toEqual(record);
        expect(live.status()).toEqual({ state: "live", record });

        const { profile, derivation } = await live.profile("samples.nyctaxi.trips");
        expect(derivation).toBe("dialect:databricks");
        expect(profile.rowCount).toBe(3);
        expect(profile.columns[0]).toMatchObject({ name: "id", type: "INTEGER" });

        const result = await live.query("SELECT 1 AS n");
        expect(result.rows).toEqual([{ n: 1 }]);
    });

    test("names the installed sources when a provider is unknown", async () => {
        const { catalog } = session();
        try {
            await catalog.open({ provider: "snowflake" });
            throw new Error("expected the open to fail");
        } catch (err) {
            expect(err).toBeInstanceOf(SourceError);
            expect((err as SourceError).code).toBe("not-configured");
            expect((err as SourceError).hint).toContain("databricks");
        }
    });
});
