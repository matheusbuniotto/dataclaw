/**
 * The extensibility claim, as a test: a new data source is a manifest plus an MCP server.
 *
 * Nothing under `src/datasource/` is aware of this fixture. If adding Snowflake had required a
 * change there, this file could not exist as written.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { DataSourceCatalog } from "../src/datasource/catalog";
import { DataSourceRegistry, type SourceRecordStore } from "../src/datasource/session";
import type { SourceRecord } from "../src/datasource/types";
import { discoverPlugins } from "../src/plugins/manifest";

const FAKE_SNOWFLAKE = resolve(import.meta.dir, "fixtures/plugins/fake-snowflake-mcp");

class MemoryStore implements SourceRecordStore {
    record?: SourceRecord;
    async read() { return this.record; }
    async write(record: SourceRecord) { this.record = record; }
    async clear() { this.record = undefined; }
}

function session() {
    const plugins = discoverPlugins({ root: resolve(import.meta.dir, "no-project"), paths: [FAKE_SNOWFLAKE] });
    const catalog = new DataSourceCatalog({ projectRoot: resolve(import.meta.dir, "no-project"), plugins });
    const store = new MemoryStore();
    const registry = new DataSourceRegistry({ catalog, storeFor: () => store, reconnectCooldownMs: 0 });
    return { session: registry.for(1), store, catalog };
}

describe("a new data MCP needs a manifest, not a code change", () => {
    test("the catalog lists it next to the built-in sources", () => {
        const { catalog } = session();
        expect(catalog.list().map((provider) => provider.id)).toEqual(["local", "databricks", "fake-snowflake"]);
    });

    test("connects, records the provider, and reconnects from the record", async () => {
        const { session: live, store } = session();
        const record = await live.connect({ provider: "fake-snowflake" });

        expect(record).toMatchObject({ provider: "fake-snowflake", dialect: "snowflake" });
        expect(store.record).toEqual(record);
        expect(live.status()).toEqual({ state: "live", record });
    });

    test("discovers databases, schemas and tables through the manifest's tool", async () => {
        const { session: live } = session();
        await live.connect({ provider: "fake-snowflake" });

        expect(await live.discover({ step: "children" })).toEqual([{ name: "ANALYTICS", kind: "namespace" }]);
        expect(await live.discover({ step: "children", scope: { namespace: ["ANALYTICS"] } }))
            .toEqual([{ name: "PUBLIC", kind: "namespace" }]);
        expect(await live.discover({ step: "children", scope: { namespace: ["ANALYTICS", "PUBLIC"] } }))
            .toEqual([{ name: "ORDERS", kind: "dataset", detail: "TABLE" }]);
    });

    test("describes and profiles with the Snowflake dialect", async () => {
        const { session: live } = session();
        await live.connect({ provider: "fake-snowflake" });

        const columns = await live.discover({ step: "columns", dataset: "ANALYTICS.PUBLIC.ORDERS" });
        expect(columns).toEqual([
            { name: "ID", kind: "column", detail: "NUMBER(38,0)" },
            { name: "AMOUNT", kind: "column", detail: "NUMBER(10,2)" },
        ]);

        const { profile, derivation } = await live.profile("ANALYTICS.PUBLIC.ORDERS");
        expect(derivation).toBe("dialect:snowflake");
        expect(profile.rowCount).toBe(3);
        expect(profile.columns.find((column) => column.name === "AMOUNT")).toMatchObject({
            type: "REAL",
            nullCount: 1,
            distinctCount: 2,
            median: 15,
        });
    });

    test("queries, and refuses a mutation before the server sees it", async () => {
        const { session: live } = session();
        await live.connect({ provider: "fake-snowflake" });

        expect(await live.query("SELECT 1 AS n")).toMatchObject({ rows: [{ n: 1 }] });

        try {
            await live.query("DELETE FROM ANALYTICS.PUBLIC.ORDERS");
            throw new Error("expected a refusal");
        } catch (err) {
            expect((err as { code?: string }).code).toBe("read-only-violation");
        }
    });
});
