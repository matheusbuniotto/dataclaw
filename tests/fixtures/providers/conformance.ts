import { describe, expect, test } from "bun:test";
import { SourceError, type DataProvider } from "../../../src/datasource/types";

/**
 * The scenarios a provider must be able to take on. How a factory produces one is its business:
 * scripted faults in the fake, a fake transport for a real provider, a slow server for a real one.
 */
export type ProviderScenario =
    | "healthy"
    | "auth-expired"
    | "auth-denied"
    | "unreachable"
    | "server-error"
    | "slow"
    | "no-describe";

export interface ProviderHarness {
    provider: DataProvider;
    /** SQL that reached the transport. A refused statement must not appear here. */
    executed: string[];
    /** Change the scripted scenario mid-test. The fake implements it; a real provider may not. */
    setScenario?(scenario: ProviderScenario): void;
    /** What the server publishes, so the suite checks the right branch. */
    capabilities?: { describe?: boolean; inventory?: boolean; profile?: boolean };
    close(): Promise<void>;
}

async function failureOf(call: Promise<unknown>): Promise<SourceError> {
    try {
        await call;
    } catch (err) {
        expect(err).toBeInstanceOf(SourceError);
        return err as SourceError;
    }
    throw new Error("expected the call to fail, but it returned");
}

/**
 * The provider contract, run once per provider. Every test goes through the port; none reaches into
 * an implementation. A second provider (Databricks over its fake MCP server, Snowflake over a fake
 * stdio server) reuses this suite by supplying its own factory.
 */
export function providerConformance(
    label: string,
    create: (scenario: ProviderScenario) => Promise<ProviderHarness>,
): void {
    describe(`${label} · provider conformance`, () => {
        test("reports a stable id, kind and dialect", async () => {
            const { provider, close } = await create("healthy");
            try {
                expect(provider.id).toBeTruthy();
                expect(["local", "remote"]).toContain(provider.kind);
                expect(provider.dialect.id).toBeTruthy();
                expect(typeof provider.dialect.isReadOnly).toBe("function");
            } finally {
                await close();
            }
        });

        test("probe reports the server's tools and a proven read-only mode", async () => {
            const { provider, close } = await create("healthy");
            try {
                const probe = await provider.probe();
                expect(probe.tools.length).toBeGreaterThan(0);
                expect(["tool", "role", "checked"]).toContain(probe.readOnly);
            } finally {
                await close();
            }
        });

        test("probe is stable when called twice", async () => {
            const { provider, close } = await create("healthy");
            try {
                expect(await provider.probe()).toEqual(await provider.probe());
            } finally {
                await close();
            }
        });

        test("execute returns columns, rows and a row count", async () => {
            const { provider, close } = await create("healthy");
            try {
                const result = await provider.execute("SELECT 1");
                expect(Array.isArray(result.rows)).toBe(true);
                expect(Array.isArray(result.columns)).toBe(true);
                expect(typeof result.rowCount).toBe("number");
                expect(typeof result.executionTimeMs).toBe("number");
            } finally {
                await close();
            }
        });

        test("refuses a mutating statement before the transport sees it", async () => {
            const harness = await create("healthy");
            try {
                const error = await failureOf(harness.provider.execute("DELETE FROM main.default.orders"));
                expect(error.code).toBe("read-only-violation");
                expect(error.retryable).toBe(false);
                expect(harness.executed).toEqual([]);
            } finally {
                await harness.close();
            }
        });

        test("refuses every mutating keyword, not only DELETE", async () => {
            const harness = await create("healthy");
            try {
                for (const sql of ["DROP TABLE t", "INSERT INTO t VALUES (1)", "MERGE INTO t USING s ON 1=1"]) {
                    const error = await failureOf(harness.provider.execute(sql));
                    expect(error.code).toBe("read-only-violation");
                }
                expect(harness.executed).toEqual([]);
            } finally {
                await harness.close();
            }
        });

        test("does not start a call when the signal is already aborted", async () => {
            const harness = await create("healthy");
            const controller = new AbortController();
            controller.abort();
            try {
                const error = await failureOf(harness.provider.execute("SELECT 1", { signal: controller.signal }));
                expect(error.code).toBe("aborted");
                expect(harness.executed).toEqual([]);
            } finally {
                await harness.close();
            }
        });

        test("stops an in-flight call when the signal aborts", async () => {
            const harness = await create("slow");
            const controller = new AbortController();
            try {
                const call = harness.provider.execute("SELECT 1", { signal: controller.signal });
                setTimeout(() => controller.abort(), 10);
                const error = await failureOf(call);
                expect(error.code).toBe("aborted");
                expect(error.retryable).toBe(true);
            } finally {
                await harness.close();
            }
        });

        test("surfaces an expired credential as retryable", async () => {
            const harness = await create("auth-expired");
            try {
                const error = await failureOf(harness.provider.execute("SELECT 1"));
                expect(error.code).toBe("auth-expired");
                expect(error.retryable).toBe(true);
                expect(error.hint).toBeTruthy();
            } finally {
                await harness.close();
            }
        });

        test("surfaces a denied credential as final", async () => {
            const harness = await create("auth-denied");
            try {
                const error = await failureOf(harness.provider.execute("SELECT 1"));
                expect(error.code).toBe("auth-denied");
                expect(error.retryable).toBe(false);
            } finally {
                await harness.close();
            }
        });

        test("surfaces an unreachable source as a retryable transport failure", async () => {
            const harness = await create("unreachable");
            try {
                const error = await failureOf(harness.provider.execute("SELECT 1"));
                expect(error.code).toBe("transport");
                expect(error.retryable).toBe(true);
            } finally {
                await harness.close();
            }
        });

        test("passes the server's message through a query error", async () => {
            const harness = await create("server-error");
            try {
                const error = await failureOf(harness.provider.execute("SELECT * FROM missing"));
                expect(error.code).toBe("query-error");
                expect(error.message).toContain("table not found");
            } finally {
                await harness.close();
            }
        });

        test("exposes describe exactly when the server publishes it", async () => {
            const harness = await create("healthy");
            try {
                const expected = harness.capabilities?.describe !== false;
                expect(typeof harness.provider.describe === "function").toBe(expected);
                if (!expected) return;
                const columns = await harness.provider.describe!("main.default.orders");
                expect(columns.length).toBeGreaterThan(0);
                expect(["INTEGER", "REAL", "TEXT"]).toContain(columns[0]!.kind);
            } finally {
                await harness.close();
            }
        });

        test("leaves describe undefined when the server publishes no such tool", async () => {
            const { provider, close } = await create("no-describe");
            try {
                expect(provider.describe).toBeUndefined();
                // The fallback is the dialect's job, not a second capability flag.
                expect(provider.dialect.describeSql("main.default.orders")).toContain("orders");
            } finally {
                await close();
            }
        });

        test("close is idempotent", async () => {
            const { close } = await create("healthy");
            await close();
            await expect(close()).resolves.toBeUndefined();
        });
    });
}
