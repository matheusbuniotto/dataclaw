/**
 * The `dataSource` manifest block: the contract a new data MCP fills in. It is inert until the
 * data-source session reads it, so these tests only pin the shape and the fail-closed rules.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginAgentTools } from "../src/plugins/agent-tools";
import { discoverPlugins, validateManifest } from "../src/plugins/manifest";

const SOURCE = "/w/plugins/snowfake/plugin.json";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: "snowfake",
        version: "1.0.0",
        description: "A Snowflake warehouse over MCP",
        domain: "data",
        capabilities: [],
        transport: { type: "mcp-http", url: "${SNOWFLAKE_MCP_URL}" },
        dataSource: {
            dialect: "snowflake",
            tools: { query: "run_sql", describe: "describe_table", inventory: "list_objects" },
            readOnly: { mode: "tool", tool: "run_sql", argument: "read_only", value: true },
            auth: [
                { kind: "env", vars: ["SNOWFLAKE_TOKEN"] },
                { kind: "cli-profile", default: "prod" },
            ],
            arguments: { query: "sql" },
        },
        ...overrides,
    };
}

function dataSource(overrides: Record<string, unknown>): Record<string, unknown> {
    const base = manifest();
    return { ...base, dataSource: { ...(base.dataSource as Record<string, unknown>), ...overrides } };
}

describe("dataSource manifest", () => {
    test("accepts an mcp-http data source", () => {
        const loaded = validateManifest(manifest(), SOURCE);
        expect(loaded.dataSource?.dialect).toBe("snowflake");
        expect(loaded.dataSource?.tools.query).toBe("run_sql");
        expect(loaded.dataSource?.readOnly.mode).toBe("tool");
    });

    test("accepts a stdio data source whose server enforces read-only with a role", () => {
        const loaded = validateManifest(manifest({
            transport: { type: "mcp", command: "uvx", args: ["mcp-server-snowflake"] },
            dataSource: {
                dialect: "snowflake",
                tools: { query: "run_query" },
                readOnly: { mode: "role", note: "role ANALYST_RO has SELECT only" },
            },
        }), SOURCE);
        expect(loaded.dataSource?.readOnly.mode).toBe("role");
    });

    test("leaves a plugin without the block untouched", () => {
        const loaded = validateManifest(manifest({ dataSource: undefined }), SOURCE);
        expect(loaded.dataSource).toBeUndefined();
    });

    test("rejects an unknown dialect", () => {
        expect(() => validateManifest(dataSource({ dialect: "postgres" }), SOURCE))
            .toThrow(/snowfake\/plugin\.json: "dataSource\.dialect" must be one of: databricks, snowflake, bigquery, ansi/);
    });

    test("requires the query tool", () => {
        expect(() => validateManifest(dataSource({ tools: { describe: "describe_table" } }), SOURCE))
            .toThrow(/"dataSource\.tools\.query" must be a non-empty string/);
    });

    test("rejects one tool name used for two roles", () => {
        expect(() => validateManifest(dataSource({ tools: { query: "run_sql", describe: "run_sql" } }), SOURCE))
            .toThrow(/"dataSource\.tools\.describe" repeats the tool "run_sql"/);
    });

    test("requires argument and value together when read-only is an argument", () => {
        expect(() => validateManifest(dataSource({ readOnly: { mode: "tool", argument: "read_only" } }), SOURCE))
            .toThrow(/"dataSource\.readOnly\.argument" and "value" must be provided together/);
    });

    test("rejects a tool name on a read-only mode that does not use one", () => {
        expect(() => validateManifest(dataSource({ readOnly: { mode: "role", tool: "run_sql" } }), SOURCE))
            .toThrow(/uses tool\/argument\/value only with mode "tool"/);
    });

    test("rejects an env auth entry with no names", () => {
        expect(() => validateManifest(dataSource({ auth: [{ kind: "env", vars: [] }] }), SOURCE))
            .toThrow(/env entry needs a non-empty "vars" array of names/);
    });

    test("rejects an unknown auth kind", () => {
        expect(() => validateManifest(dataSource({ auth: [{ kind: "token" }] }), SOURCE))
            .toThrow(/"dataSource\.auth\.kind" must be env, cli-profile, oauth or service-principal/);
    });

    test("rejects an empty argument name mapping", () => {
        expect(() => validateManifest(dataSource({ arguments: { query: "  " } }), SOURCE))
            .toThrow(/"dataSource\.arguments\.query" must be a non-empty string/);
    });

    test("rejects a data source on a script transport", () => {
        expect(() => validateManifest(manifest({
            transport: { type: "script", command: "snowflake-script" },
            capabilities: ["data.run_sql@1"],
        }), SOURCE)).toThrow(/"dataSource" requires an MCP transport/);
    });
});

describe("a data source is not opened by the tool bridge", () => {
    const root = mkdtempSync(join(tmpdir(), "dataclaw-datasource-"));
    mkdirSync(join(root, "plugins", "snowfake"), { recursive: true });
    writeFileSync(join(root, "plugins", "snowfake", "plugin.json"), JSON.stringify(manifest({
        // If the bridge tried to start this, the test would see a failure instead of silence.
        transport: { type: "mcp", command: "definitely-not-a-real-command-xyz" },
    })));

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    test("discovery still finds it, so the session can", () => {
        const found = discoverPlugins({ root });
        expect(found.map((plugin) => plugin.manifest.name)).toEqual(["snowfake"]);
        expect(found[0]?.manifest.dataSource?.dialect).toBe("snowflake");
    });

    test("the agent tool bridge skips it without contacting the server", async () => {
        const tools = await createPluginAgentTools({ root });
        try {
            expect(tools.errors).toEqual([]);
            expect(tools.toolNames).toEqual([]);
            expect(tools.plugins).toEqual([]);
        } finally {
            await tools.close();
        }
    });
});
