/**
 * A data source declared by a manifest, driven through a stub MCP transport. The manifest is the
 * whole authoring surface, so these tests are about the contract a provider author relies on:
 * argument names, result decoding, and the fail-closed checks at connect.
 */
import { describe, expect, test } from "bun:test";
import { ansiDialect } from "../src/datasource/dialects";
import {
    datasetProfileFromValue,
    manifestProvider,
    queryResultFromValue,
    verifyProviderTools,
} from "../src/datasource/providers/manifest";
import { SourceError } from "../src/datasource/types";
import type { DataSourceManifest } from "../src/plugins/types";
import { validateManifest } from "../src/plugins/manifest";
import type { McpToolClient } from "../src/plugins/transports";
import type { LoadedPlugin } from "../src/plugins/types";

function plugin(overrides: Record<string, unknown> = {}): LoadedPlugin {
    const manifest = validateManifest({
        name: "snowfake",
        version: "1.0.0",
        description: "A fake Snowflake",
        domain: "data",
        capabilities: [],
        transport: { type: "mcp-http", url: "http://127.0.0.1:9/mcp" },
        dataSource: {
            dialect: "ansi",
            tools: { query: "run_sql", describe: "describe_table", inventory: "list_objects", profile: "profile_table" },
            readOnly: { mode: "tool", argument: "read_only", value: true },
            arguments: { query: "statement" },
            ...overrides,
        },
    }, "/tmp/plugins/snowfake/plugin.json");
    return { manifest, source: "/tmp/plugins/snowfake/plugin.json", cwd: "/tmp/plugins/snowfake" };
}

const ALL_TOOLS = ["run_sql", "describe_table", "list_objects", "profile_table"];

function transport(
    handler: (name: string, args: Record<string, unknown>) => unknown,
    tools: string[] = ALL_TOOLS,
): McpToolClient & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
        plugin: plugin(),
        listTools: async () => [...tools],
        listToolDefinitions: async () => [],
        callTool: async (name: string, args: Record<string, unknown>) => {
            calls.push({ name, args });
            return handler(name, args);
        },
        invoke: async () => undefined,
        close: async () => undefined,
        calls,
    };
    return client as McpToolClient & { calls: typeof calls };
}

describe("manifest provider", () => {
    test("calls the query tool with the manifest's argument names and read-only flag", async () => {
        const mcp = transport(() => ({ columns: ["n"], rows: [{ n: 1 }], rowCount: 1 }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        const result = await provider.execute("SELECT 1");

        expect(mcp.calls).toEqual([{ name: "run_sql", args: { statement: "SELECT 1", read_only: true } }]);
        expect(result).toEqual({ columns: ["n"], rows: [{ n: 1 }], rowCount: 1, executionTimeMs: expect.any(Number) });
    });

    test("slices rows to maxRows without touching the server's count", async () => {
        const mcp = transport(() => ({ columns: ["n"], rows: [{ n: 1 }, { n: 2 }, { n: 3 }] }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        const result = await provider.execute("SELECT n", { maxRows: 2 });
        expect(result.rows).toHaveLength(2);
        expect(result.rowCount).toBe(3);
    });

    test("refuses a mutating statement before the transport", async () => {
        const mcp = transport(() => ({ columns: [], rows: [] }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        try {
            await provider.execute("DELETE FROM orders");
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(SourceError);
            expect((err as SourceError).code).toBe("read-only-violation");
        }
        expect(mcp.calls).toEqual([]);
    });

    test("does not call the server when the signal is already aborted", async () => {
        const mcp = transport(() => ({ columns: ["n"], rows: [{ n: 1 }] }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);
        const controller = new AbortController();
        controller.abort();

        await expect(provider.execute("SELECT 1", { signal: controller.signal }))
            .rejects.toMatchObject({ code: "aborted" });
        expect(mcp.calls).toEqual([]);
    });

    test("decodes describe rows and classifies the types", async () => {
        const mcp = transport(() => ({
            columns: ["column_name", "data_type"],
            rows: [["id", "BIGINT"], ["amount", "DOUBLE"], ["placed_at", "TIMESTAMP"]],
        }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        const columns = await provider.describe!("main.default.orders");
        expect(columns.map((column) => [column.name, column.kind, column.numeric, column.temporal])).toEqual([
            ["id", "INTEGER", true, false],
            ["amount", "REAL", true, false],
            ["placed_at", "TEXT", false, true],
        ]);
        expect(mcp.calls[0]).toEqual({ name: "describe_table", args: { table: "main.default.orders" } });
    });

    test("passes the namespace array to inventory and labels the level", async () => {
        const mcp = transport(() => ({ columns: ["name"], rows: [{ name: "orders" }] }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        const found = await provider.inventory!({ namespace: ["main", "default"] });
        expect(mcp.calls[0]).toEqual({ name: "list_objects", args: { namespace: ["main", "default"] } });
        expect(found).toEqual([{ name: "orders", kind: "dataset" }]);
    });

    test("uses a native profile only when its shape is right", async () => {
        const mcp = transport(() => ({
            rowCount: 3,
            columns: [{ name: "amount", type: "REAL", nullCount: 1, nullPct: 33.33, distinctCount: 2, sampleValues: [10, 20] }],
        }));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        const profile = await provider.profile!("main.default.orders");
        expect(profile).toMatchObject({ tableName: "main.default.orders", rowCount: 3, columnCount: 1 });

        const wrong = transport(() => ({ rows: [] }));
        const broken = manifestProvider(plugin(), wrong, ansiDialect);
        await expect(broken.profile!("main.default.orders"))
            .rejects.toMatchObject({ code: "query-error", hint: expect.stringContaining("dataSource.tools.profile") });
    });

    test("probe checks the declared tools against what the server lists", async () => {
        const mcp = transport(() => ({}), ["run_sql"]);
        const provider = manifestProvider(plugin(), mcp, ansiDialect);

        try {
            await provider.probe();
            throw new Error("expected the probe to fail");
        } catch (err) {
            const failure = err as SourceError;
            expect(failure.code).toBe("unsupported-capability");
            expect(failure.message).toContain("describe tool \"describe_table\"");
            expect(failure.available).toEqual(["run_sql"]);
            expect(failure.hint).toContain("dataSource.tools");
        }
    });

    test("probe reports the manifest's read-only mode", async () => {
        const mcp = transport(() => ({}));
        const provider = manifestProvider(plugin(), mcp, ansiDialect);
        expect(await provider.probe()).toEqual({ tools: ALL_TOOLS, readOnly: "tool" });
    });
});

describe("result decoding", () => {
    test("accepts an object of columns and record rows", () => {
        expect(queryResultFromValue({ columns: ["a"], rows: [{ a: 1 }] }, "snowfake"))
            .toMatchObject({ columns: ["a"], rows: [{ a: 1 }], rowCount: 1 });
    });

    test("accepts named columns and positional rows", () => {
        expect(queryResultFromValue({ columns: [{ name: "a" }, { name: "b" }], rows: [[1, 2]] }, "snowfake"))
            .toMatchObject({ columns: ["a", "b"], rows: [{ a: 1, b: 2 }] });
    });

    test("accepts a bare array of records", () => {
        expect(queryResultFromValue([{ a: 1 }, { a: 2 }], "snowfake"))
            .toMatchObject({ columns: ["a"], rows: [{ a: 1 }, { a: 2 }], rowCount: 2 });
    });

    test("refuses a shape it does not understand, naming the manifest field to fix", () => {
        try {
            queryResultFromValue("not a table", "snowfake");
            throw new Error("expected the decode to fail");
        } catch (err) {
            expect((err as SourceError).code).toBe("query-error");
            expect((err as SourceError).hint).toContain("{ columns, rows }");
        }
    });

    test("profile decoding refuses a missing row count", () => {
        expect(() => datasetProfileFromValue({ columns: [{ name: "a" }] }, "t", "snowfake")).not.toThrow();
        expect(() => datasetProfileFromValue({}, "t", "snowfake")).toThrow(SourceError);
    });
});

describe("declared tool verification", () => {
    const spec = (overrides: Partial<DataSourceManifest> = {}): DataSourceManifest => ({
        dialect: "ansi",
        tools: { query: "run_sql", describe: "describe_table" },
        readOnly: { mode: "checked" },
        ...overrides,
    });

    test("passes when every declared tool is published", () => {
        expect(() => verifyProviderTools(spec(), ["run_sql", "describe_table"], "snowfake")).not.toThrow();
    });

    test("names the missing role and the real tool list", () => {
        try {
            verifyProviderTools(spec(), ["run_sql"], "snowfake");
            throw new Error("expected the check to fail");
        } catch (err) {
            const failure = err as SourceError;
            expect(failure.code).toBe("unsupported-capability");
            expect(failure.message).toContain("describe tool \"describe_table\"");
            expect(failure.available).toEqual(["run_sql"]);
        }
    });

    test("refuses a read-only mode whose tool is not published", () => {
        try {
            verifyProviderTools(
                spec({ tools: { query: "run_sql" }, readOnly: { mode: "tool", tool: "run_sql_read_only" } }),
                ["run_sql"],
                "snowfake",
            );
            throw new Error("expected the check to fail");
        } catch (err) {
            expect((err as SourceError).code).toBe("read-only-unavailable");
            expect((err as SourceError).available).toEqual(["run_sql"]);
        }
    });
});
