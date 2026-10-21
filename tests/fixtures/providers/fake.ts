/**
 * An in-memory warehouse that satisfies the `DataProvider` port.
 *
 * It is a real conformance target, not a stub: it answers describe, inventory and the profile
 * aggregate the dialect generates, so the session's readback can be tested without a warehouse.
 * A scenario scripts the failures a provider has to translate into `SourceError`.
 */
import { ansiDialect } from "../../../src/datasource/dialects";
import type { QueryResult } from "../../../src/adapters/adapter-interface";
import {
    SourceError,
    type ColumnTraits,
    type DataProvider,
    type DatasetScope,
    type DescribedColumn,
    type Discovery,
} from "../../../src/datasource/types";
import type { ProviderHarness, ProviderScenario } from "./conformance";

export interface FakeDataset {
    columns: DescribedColumn[];
    rows: Array<Record<string, unknown>>;
}

export interface FakeOptions {
    /** Keyed by the name the dialect qualifies, e.g. "main.default.orders". */
    datasets?: Record<string, FakeDataset>;
    /** Server tool names. Leave out `describe_table` to exercise the dialect fallback. */
    tools?: string[];
}

const DEFAULT_TOOLS = ["run_sql", "describe_table", "list_objects"];

function column(name: string, dataType: string): DescribedColumn {
    const traits: ColumnTraits = ansiDialect.classify(dataType);
    return { name, dataType, ...traits };
}

const ORDERS: FakeDataset = {
    columns: [column("id", "INTEGER"), column("amount", "DOUBLE"), column("placed_at", "TIMESTAMP")],
    rows: [
        { id: 1, amount: 10, placed_at: "2026-01-01" },
        { id: 2, amount: 20, placed_at: "2026-01-02" },
        { id: 3, amount: null, placed_at: "2026-01-03" },
    ],
};

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** The dataset a generated statement reads, by the last part of its `FROM`. */
function targetDataset(sql: string): string | undefined {
    const match = /FROM\s+(.+?)\s*$/i.exec(sql.trim());
    if (!match) return undefined;
    const parts = match[1]!.replace(/[`"]/g, "").split(".");
    return parts[parts.length - 1];
}

/** Compute the aggregate the dialect's profile SQL asks for, alias for alias. */
function aggregateRow(dataset: FakeDataset): Record<string, unknown> {
    const row: Record<string, unknown> = { __row_count: dataset.rows.length };
    dataset.columns.forEach((definition, index) => {
        const values = dataset.rows
            .map((record) => record[definition.name])
            .filter((value) => value !== null && value !== undefined);
        row[`c${index}__non_null`] = values.length;
        row[`c${index}__distinct`] = new Set(values).size;

        if (definition.numeric) {
            const numbers = values.map(Number).filter(Number.isFinite);
            row[`c${index}__min`] = numbers.length ? Math.min(...numbers) : null;
            row[`c${index}__max`] = numbers.length ? Math.max(...numbers) : null;
            row[`c${index}__mean`] = numbers.length
                ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
                : null;
            row[`c${index}__median`] = median(numbers);
        } else if (definition.temporal) {
            const sorted = [...values].sort();
            row[`c${index}__min`] = sorted[0] ?? null;
            row[`c${index}__max`] = sorted[sorted.length - 1] ?? null;
        }
    });
    return row;
}

function failureFor(scenario: ProviderScenario): SourceError | undefined {
    switch (scenario) {
        case "auth-expired":
            return new SourceError("auth-expired", "the bearer token expired", {
                hint: "Reconnect the data source to mint a new token.",
            });
        case "auth-denied":
            return new SourceError("auth-denied", "this identity cannot read the table", {
                hint: "Ask the warehouse owner for SELECT on this schema.",
            });
        case "unreachable":
            return new SourceError("transport", "could not reach the endpoint: ECONNREFUSED");
        case "server-error":
            return new SourceError("query-error", "warehouse said: table not found");
        default:
            return undefined;
    }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new SourceError("aborted", "Stopped."));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new SourceError("aborted", "Stopped."));
        };
        function done() {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function fakeHarness(scenario: ProviderScenario = "healthy", options: FakeOptions = {}): ProviderHarness {
    const datasets = options.datasets ?? { "main.default.orders": ORDERS };
    const tools = [...(options.tools ?? DEFAULT_TOOLS)];
    const executed: string[] = [];
    let closed = false;

    const resolveDataset = (name: string): FakeDataset | undefined => {
        const short = name.replace(/[`"]/g, "").split(".").pop()!;
        return datasets[name] ?? datasets[short] ?? Object.entries(datasets)
            .find(([key]) => key.split(".").pop() === short)?.[1];
    };

    const provider: DataProvider = {
        id: "fake",
        kind: "remote",
        dialect: ansiDialect,
        async probe() {
            return { tools: [...tools], readOnly: "tool" };
        },
        async execute(sql: string, executeOptions = {}): Promise<QueryResult> {
            if (!provider.dialect.isReadOnly(sql)) {
                throw new SourceError("read-only-violation", "Only read-only SQL is permitted.");
            }
            if (executeOptions.signal?.aborted) {
                throw new SourceError("aborted", "Stopped.");
            }
            executed.push(sql);
            if (scenario === "slow") await abortableDelay(200, executeOptions.signal);

            const failure = failureFor(scenario);
            if (failure) throw failure;

            const dataset = targetDataset(sql) ? resolveDataset(targetDataset(sql)!) : undefined;
            if (dataset && sql.includes("__row_count")) {
                return { columns: [], rows: [aggregateRow(dataset)], rowCount: 1, executionTimeMs: 1 };
            }
            return { columns: ["n"], rows: [{ n: 1 }], rowCount: 1, executionTimeMs: 1 };
        },
        async close() {
            closed = true;
        },
        ...(tools.includes("describe_table")
            ? {
                async describe(dataset: string): Promise<DescribedColumn[]> {
                    const found = resolveDataset(dataset);
                    if (!found) throw new SourceError("query-error", `unknown dataset "${dataset}"`);
                    return [...found.columns];
                },
            }
            : {}),
        ...(tools.includes("list_objects")
            ? {
                async inventory(scope: DatasetScope | undefined): Promise<Discovery[]> {
                    const namespace = scope?.namespace ?? [];
                    if (namespace.length === 0) return [{ name: "main", kind: "namespace" }];
                    if (namespace.length === 1) {
                        return Object.keys(datasets).sort().map((name) => ({
                            name: name.split(".").pop()!,
                            kind: "dataset" as const,
                            detail: "TABLE",
                        }));
                    }
                    return [];
                },
            }
            : {}),
    };

    return {
        provider,
        executed,
        async close() {
            if (!closed) await provider.close();
            closed = true;
        },
    };
}
