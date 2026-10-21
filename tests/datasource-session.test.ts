/**
 * The session, tested through its interface: connect ordering, per-conversation isolation, abort,
 * discovery and profile composition, and reconnect from the durable record.
 *
 * The provider is the fake warehouse and the record is memory, so a failure here is a session
 * failure, not a harness or a network effect.
 */
import { describe, expect, test } from "bun:test";
import { DataSourceRegistry, type ProviderCatalog, type SourceRecordStore } from "../src/datasource/session";
import { SourceError, type ConnectIntent, type SourceRecord } from "../src/datasource/types";
import type { ProviderScenario } from "./fixtures/providers/conformance";
import { fakeHarness } from "./fixtures/providers/fake";

class MemoryStore implements SourceRecordStore {
    record?: SourceRecord;
    writes: SourceRecord[] = [];

    async read(): Promise<SourceRecord | undefined> {
        return this.record;
    }

    async write(record: SourceRecord): Promise<void> {
        this.record = record;
        this.writes.push(record);
    }

    async clear(): Promise<void> {
        this.record = undefined;
    }
}

function setup(options: {
    scenario?: ProviderScenario;
    tools?: string[];
    reconnectCooldownMs?: number;
} = {}) {
    const stores = new Map<string, MemoryStore>();
    const intents: ConnectIntent[] = [];
    let opened = 0;
    let failure: SourceError | undefined;
    let last = fakeHarness(options.scenario ?? "healthy", options.tools ? { tools: options.tools } : {});

    const catalog: ProviderCatalog = {
        list: () => [{ id: "fake", kind: "remote", dialect: "ansi", label: "Fake warehouse" }],
        async open(intent: ConnectIntent) {
            intents.push(intent);
            if (failure) throw failure;
            opened++;
            last = fakeHarness(options.scenario ?? "healthy", options.tools ? { tools: options.tools } : {});
            return last.provider;
        },
    };

    const store = (id = "1"): MemoryStore => {
        let found = stores.get(id);
        if (!found) {
            found = new MemoryStore();
            stores.set(id, found);
        }
        return found;
    };

    const registry = new DataSourceRegistry({
        catalog,
        storeFor: (id) => store(id),
        reconnectCooldownMs: options.reconnectCooldownMs ?? 0,
    });

    return {
        registry,
        catalog,
        store,
        intents,
        opened: () => opened,
        last: () => last,
        failNext(error?: SourceError) {
            failure = error;
        },
    };
}

const CONNECT: ConnectIntent = { provider: "fake" };

async function failure(promise: Promise<unknown>): Promise<SourceError> {
    try {
        await promise;
    } catch (err) {
        expect(err).toBeInstanceOf(SourceError);
        return err as SourceError;
    }
    throw new Error("expected the call to fail, but it resolved");
}

describe("session lifecycle", () => {
    test("starts idle with no provider", () => {
        const s = setup();
        const session = s.registry.for(1);
        expect(session.status()).toEqual({ state: "idle" });
        expect(session.providerId).toBe("");
    });

    test("connect records the source and reports live", async () => {
        const s = setup();
        const session = s.registry.for(1);
        const record = await session.connect({ ...CONNECT, dataset: "main.default.orders" });

        expect(record).toMatchObject({ provider: "fake", dialect: "ansi", dataset: "main.default.orders" });
        expect(record.connectedAt).toBeGreaterThan(0);
        expect(Object.keys(record)).not.toContain("token");
        expect(session.status()).toEqual({ state: "live", record });
        expect(s.store("1").record).toEqual(record);
        expect(s.opened()).toBe(1);
    });

    test("a failed second connect leaves the first source live and the record untouched", async () => {
        const s = setup();
        const session = s.registry.for(1);
        const first = await session.connect(CONNECT);

        s.failNext(new SourceError("auth-denied", "nope", { provider: "fake" }));
        const error = await failure(session.connect(CONNECT));

        expect(error.code).toBe("auth-denied");
        expect(session.status()).toEqual({ state: "live", record: first });
        expect(s.store("1").writes).toHaveLength(1);
        expect(s.store("1").record).toEqual(first);
    });

    test("a failed first connect reports failed and writes nothing", async () => {
        const s = setup();
        s.failNext(new SourceError("not-configured", "no manifest", { hint: "install one" }));

        const session = s.registry.for(1);
        await failure(session.connect(CONNECT));

        expect(session.status().state).toBe("failed");
        expect(s.store("1").record).toBeUndefined();
        expect(s.store("1").writes).toHaveLength(0);
    });

    test("a catalog failure keeps its hint and the server's tool list", async () => {
        const s = setup();
        const raised = new SourceError("unsupported-capability", "declared describe tool is missing", {
            available: ["run_sql"],
            hint: "add dataSource.tools.describe",
        });
        s.failNext(raised);

        const error = await failure(s.registry.for(1).connect(CONNECT));
        expect(error).toBe(raised);
        expect(error.available).toEqual(["run_sql"]);
        expect(error.hint).toContain("dataSource.tools.describe");
    });

    test("two conversations have isolated sessions and records", async () => {
        const s = setup();
        const one = s.registry.for(1);
        const two = s.registry.for(2);
        expect(one).not.toBe(two);

        await one.connect(CONNECT);
        expect(two.status()).toEqual({ state: "idle" });
        expect(s.store("2").record).toBeUndefined();

        await two.connect(CONNECT);
        expect(s.store("1").record?.provider).toBe("fake");
        expect(s.store("2").record?.provider).toBe("fake");
        expect(s.opened()).toBe(2);
    });

    test("an intake is absent for a remote provider", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect(CONNECT);
        expect(session.intake).toBeUndefined();
    });
});

describe("cancellation", () => {
    test("two concurrent queries keep their own signals", async () => {
        const s = setup({ scenario: "slow" });
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        const controller = new AbortController();
        const aborted = session.query("SELECT 1", { signal: controller.signal });
        const completed = session.query("SELECT 2");
        controller.abort();

        const error = await failure(aborted);
        expect(error.code).toBe("aborted");
        await expect(completed).resolves.toMatchObject({ rows: [{ n: 1 }] });
    });

    test("close ends an in-flight query and refuses later ones", async () => {
        const s = setup({ scenario: "slow" });
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        const pending = session.query("SELECT 1");
        setTimeout(() => void session.close(), 10);

        const error = await failure(pending);
        expect(error.code).toBe("aborted");
        expect((await failure(session.query("SELECT 1"))).code).toBe("no-session");
    });
});

describe("discovery", () => {
    test("uses the provider's inventory when it has one", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        expect(await session.discover({ step: "children", scope: { namespace: ["main"] } }))
            .toEqual([{ name: "orders", kind: "dataset", detail: "TABLE" }]);
    });

    test("falls back to the dialect's SQL when the server publishes no inventory", async () => {
        const s = setup({ tools: ["run_sql"] });
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        expect(await session.discover({ step: "children" })).toEqual([{ name: "main", kind: "namespace" }]);
        expect(await session.discover({ step: "children", scope: { namespace: ["main", "default"] } }))
            .toEqual([{ name: "orders", kind: "dataset", detail: "TABLE" }]);
    });

    test("describes columns through the provider, with the dialect as fallback", async () => {
        const native = setup();
        const a = native.registry.for(1);
        await a.connect(CONNECT);
        const columns = await a.discover({ step: "columns", dataset: "main.default.orders" });
        expect(columns.map((column) => column.name)).toEqual(["id", "amount", "placed_at"]);
        expect(columns[0]).toEqual({ name: "id", kind: "column", detail: "INTEGER" });

        const fallback = setup({ tools: ["run_sql"] });
        const b = fallback.registry.for(1);
        await b.connect(CONNECT);
        const same = await b.discover({ step: "columns", dataset: "main.default.orders" });
        expect(same).toEqual(columns);
    });
});

describe("profile", () => {
    test("composes a profile from describe and the dialect's aggregate", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        const { profile, derivation } = await session.profile("main.default.orders");

        expect(derivation).toBe("dialect:ansi");
        expect(profile.rowCount).toBe(3);
        expect(profile.columnCount).toBe(3);
        const amount = profile.columns.find((column) => column.name === "amount")!;
        expect(amount.nullCount).toBe(1);
        expect(amount.nullPct).toBe(33.33);
        expect(amount.distinctCount).toBe(2);
        expect(amount.min).toBe(10);
        expect(amount.max).toBe(20);
        expect(amount.mean).toBe(15);
        expect(amount.median).toBe(15);
        expect(amount.sampleValues).toEqual([10, 20]);
    });

    test("remembers the profiled dataset in the record", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect(CONNECT);
        await session.profile("main.default.orders");

        expect(s.store("1").record?.dataset).toBe("main.default.orders");
        expect(s.store("1").writes).toHaveLength(2);
    });

    test("uses a native profile when the provider has one", async () => {
        const s = setup({ tools: ["run_sql", "describe_table", "profile_table"] });
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        const { profile, derivation } = await session.profile("main.default.orders");
        expect(derivation).toBe("native");
        expect(profile.rowCount).toBe(3);
    });
});

describe("query and metric", () => {
    test("refuses a mutating statement before the provider sees it", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        const error = await failure(session.query("DELETE FROM main.default.orders"));
        expect(error.code).toBe("read-only-violation");
        expect(s.last().executed.some((sql) => sql.includes("DELETE"))).toBe(false);
    });

    test("carries every provider failure through the session unchanged", async () => {
        const cases = [
            ["auth-expired", "auth-expired", true],
            ["auth-denied", "auth-denied", false],
            ["unreachable", "transport", true],
            ["server-error", "query-error", false],
        ] as const;

        for (const [scenario, code, retryable] of cases) {
            const s = setup();
            const session = s.registry.for(1);
            await session.connect(CONNECT);
            s.last().setScenario!(scenario);

            const error = await failure(session.query("SELECT 1"));
            expect(error.code).toBe(code);
            expect(error.retryable).toBe(retryable);
        }
    });

    test("computes a correlation through the dialect", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect({ ...CONNECT, dataset: "main.default.orders" });

        const metric = await session.metric({ kind: "correlation", columns: ["amount", "id"] });
        expect(metric).toMatchObject({
            kind: "correlation",
            dataset: "main.default.orders",
            sampleSize: 3,
            correlation: 0.5,
            strength: "moderate",
            direction: "positive",
            derivation: "dialect:ansi",
        });
    });

    test("computes percentiles through the dialect", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect({ ...CONNECT, dataset: "main.default.orders" });

        const metric = await session.metric({ kind: "percentiles", column: "amount" });
        expect(metric).toMatchObject({
            kind: "percentiles",
            count: 3,
            p25: 10,
            p50: 15,
            p75: 20,
            derivation: "dialect:ansi",
        });
    });

    test("needs a dataset for a metric, and says how to get one", async () => {
        const s = setup();
        const session = s.registry.for(1);
        await session.connect(CONNECT);

        const error = await failure(session.metric({ kind: "percentiles", column: "amount" }));
        expect(error.code).toBe("not-configured");
        expect(error.hint).toContain("Profile");
    });
});

describe("reconnect from the durable record", () => {
    test("a new session reconnects before its first query", async () => {
        const s = setup();
        await s.registry.for(1).connect(CONNECT);

        const fresh = new DataSourceRegistry({
            catalog: s.catalog,
            storeFor: (id) => s.store(id),
            reconnectCooldownMs: 0,
        });
        const session = fresh.for(1);
        const result = await session.query("SELECT 1");

        expect(result.rowCount).toBe(1);
        expect(s.opened()).toBe(2);
        expect(session.status().state).toBe("live");
    });

    test("a failed reconnect is not retried until the cooldown passes", async () => {
        const s = setup({ reconnectCooldownMs: 60_000 });
        await s.registry.for(1).connect(CONNECT);
        s.failNext(new SourceError("transport", "endpoint is down"));

        const fresh = new DataSourceRegistry({
            catalog: s.catalog,
            storeFor: (id) => s.store(id),
            reconnectCooldownMs: 60_000,
        });
        const session = fresh.for(1);

        expect((await failure(session.query("SELECT 1"))).code).toBe("transport");
        const second = await failure(session.query("SELECT 1"));
        expect(second.code).toBe("no-session");
        expect(second.message).toContain("yet");
    });

    test("no record means no session, with a hint that names the connect tool", async () => {
        const s = setup();
        const error = await failure(s.registry.for(9).query("SELECT 1"));
        expect(error.code).toBe("no-session");
        expect(error.hint).toContain("connect_data_source");
    });
});
