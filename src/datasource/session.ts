/**
 * The data-source session: one live source per conversation, and the only writer of the durable
 * record.
 *
 * Callers hold a `DataSourceSession` and nothing else. Providers are opened through a
 * `ProviderCatalog` (in production: the installed manifests; in tests: the fake warehouse), and the
 * record is read and written through a `SourceRecordStore` (in production: `AnalystPlanDoc`; in
 * tests: memory). Those two ports are what keep this module testable without a harness.
 */
import type { QueryResult } from "../adapters/adapter-interface";
import type { DialectName } from "../plugins/types";
import { applySamples, discoveryFromRows, parseDescribedColumns, profileFromAggregate } from "./rows";
import {
    SourceError,
    type ConnectIntent,
    type DataProvider,
    type DataSourceSession,
    type DatasetIntake,
    type DescribedColumn,
    type Discovery,
    type DiscoveryRequest,
    type MetricResult,
    type MetricSpec,
    type ProfileResult,
    type SourceErrorCode,
    type SourceRecord,
    type SourceStatus,
} from "./types";

/** One provider this process can open. `list()` feeds the tool that names the options. */
export interface ProviderDescriptor {
    id: string;
    kind: "local" | "remote";
    dialect: DialectName;
    label: string;
    /** Credential sources the provider accepts, for the prompt and the console. */
    auth?: readonly string[];
}

/** Resolve a provider by name and open it. Failures must be `SourceError`s. */
export interface ProviderCatalog {
    list(): ProviderDescriptor[];
    open(intent: ConnectIntent): Promise<DataProvider>;
}

/** The durable record, never a secret. In production this is `AnalystPlanDoc.dataSource`. */
export interface SourceRecordStore {
    read(): Promise<SourceRecord | undefined>;
    write(record: SourceRecord): Promise<void>;
    clear(): Promise<void>;
}

export interface DataSourceRegistryOptions {
    catalog: ProviderCatalog;
    storeFor(conversationId: string): SourceRecordStore;
    now?: () => number;
    /** After a failed reconnect, wait this long before trying again. Default 30s. */
    reconnectCooldownMs?: number;
}

const DEFAULT_RECONNECT_COOLDOWN_MS = 30_000;

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function asSourceError(err: unknown, fallback: SourceErrorCode, provider?: string): SourceError {
    if (err instanceof SourceError) return err;
    return new SourceError(fallback, messageOf(err), {
        ...(provider ? { provider } : {}),
        cause: err,
    });
}

/** Combine the caller's signal with the session's own, so `close()` ends in-flight calls. */
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
        if (!signal) continue;
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

function toNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function recordToIntent(record: SourceRecord): ConnectIntent {
    return {
        provider: record.provider,
        ...(record.credential ? { credential: record.credential } : {}),
        ...(record.endpoint ? { endpoint: record.endpoint } : {}),
        ...(record.dataset ? { dataset: record.dataset } : {}),
    };
}

class Session implements DataSourceSession {
    private live: { provider: DataProvider; record: SourceRecord } | undefined;
    private state: SourceStatus = { state: "idle" };
    private connecting: Promise<SourceRecord> | undefined;
    private lastReconnectAt = 0;
    private retired = false;
    private readonly closed = new AbortController();
    private readonly store: SourceRecordStore;

    constructor(
        readonly conversationId: string,
        private readonly options: DataSourceRegistryOptions,
    ) {
        this.store = options.storeFor(conversationId);
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }

    get providerId(): string {
        return this.live?.record.provider ?? "";
    }

    get intake(): DatasetIntake | undefined {
        return this.retired ? undefined : this.live?.provider.intake;
    }

    status(): SourceStatus {
        return this.state;
    }

    async connect(intent: ConnectIntent): Promise<SourceRecord> {
        if (this.retired) {
            throw new SourceError("no-session", "This data-source session is closed.", { provider: intent.provider });
        }
        // Serialize connects: a second one waits for the first, then swaps.
        if (this.connecting) await this.connecting.catch(() => undefined);
        const run = this.doConnect(intent);
        this.connecting = run;
        try {
            return await run;
        } finally {
            this.connecting = undefined;
        }
    }

    private async doConnect(intent: ConnectIntent): Promise<SourceRecord> {
        this.state = { state: "connecting", provider: intent.provider };
        let next: DataProvider | undefined;
        try {
            next = await this.options.catalog.open(intent);
            await next.probe();
            // A cheap read proves the whole path before anything is recorded.
            await next.execute("SELECT 1", { maxRows: 1 });

            const record: SourceRecord = {
                provider: next.id,
                dialect: next.dialect.id,
                connectedAt: this.now(),
                ...(intent.endpoint ? { endpoint: intent.endpoint } : {}),
                ...(intent.credential ? { credential: intent.credential } : {}),
                ...(intent.dataset ? { dataset: intent.dataset } : {}),
            };

            // Last: live implies persisted, so a restart never loses a source it was using.
            await this.store.write(record);

            const previous = this.live;
            this.live = { provider: next, record };
            this.state = { state: "live", record };
            if (previous) await previous.provider.close().catch(() => undefined);
            return record;
        } catch (err) {
            await next?.close().catch(() => undefined);
            const failure = asSourceError(err, "not-configured", intent.provider);
            this.state = this.live
                ? { state: "live", record: this.live.record }
                : { state: "failed", provider: intent.provider, error: failure };
            throw failure;
        }
    }

    /** The live provider, or one restored from the durable record (once per cooldown). */
    private async ensureLive(): Promise<{ provider: DataProvider; record: SourceRecord }> {
        if (this.retired) {
            throw new SourceError("no-session", "This data-source session is closed.");
        }
        if (this.live) return this.live;

        const record = await this.store.read();
        if (!record) {
            throw new SourceError("no-session", "No data source is connected.", {
                hint: "Call connect_data_source first.",
            });
        }

        const cooldown = this.options.reconnectCooldownMs ?? DEFAULT_RECONNECT_COOLDOWN_MS;
        const waited = this.now() - this.lastReconnectAt;
        if (this.lastReconnectAt > 0 && waited < cooldown) {
            throw new SourceError("no-session", `Could not reconnect to ${record.provider} yet.`, {
                provider: record.provider,
                hint: "Try again in a moment, or call connect_data_source.",
            });
        }
        this.lastReconnectAt = this.now();

        let provider: DataProvider | undefined;
        try {
            provider = await this.options.catalog.open(recordToIntent(record));
            await provider.probe();
            await provider.execute("SELECT 1", { maxRows: 1 });
            this.live = { provider, record };
            this.state = { state: "live", record };
            return this.live;
        } catch (err) {
            await provider?.close().catch(() => undefined);
            const failure = asSourceError(err, "transport", record.provider);
            this.state = { state: "failed", provider: record.provider, error: failure };
            throw failure;
        }
    }

    /** Run one read with the caller's signal combined with the session's close signal. */
    private async call<T>(
        signal: AbortSignal | undefined,
        fallback: SourceErrorCode,
        run: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        if (this.retired) {
            throw new SourceError("no-session", "This data-source session is closed.");
        }
        try {
            return await run(combineSignals(signal, this.closed.signal));
        } catch (err) {
            throw asSourceError(err, fallback);
        }
    }

    private async describeColumns(
        provider: DataProvider,
        dataset: string,
        signal: AbortSignal,
    ): Promise<DescribedColumn[]> {
        if (provider.describe) return provider.describe(dataset, signal);
        const rows = (await provider.execute(provider.dialect.describeSql(dataset), { maxRows: 500, signal })).rows;
        return parseDescribedColumns(rows, provider.dialect.classify);
    }

    async discover(request: DiscoveryRequest, options: { signal?: AbortSignal } = {}): Promise<Discovery[]> {
        const { provider } = await this.ensureLive();
        return this.call(options.signal, "query-error", async (signal) => {
            if (request.step === "columns") {
                const columns = await this.describeColumns(provider, request.dataset, signal);
                return columns.map((column) => ({ name: column.name, kind: "column" as const, detail: column.dataType }));
            }
            if (provider.inventory) return provider.inventory(request.scope, signal);
            const rows = (await provider.execute(provider.dialect.listChildrenSql(request.scope), { maxRows: 1000, signal })).rows;
            return discoveryFromRows(rows, provider.dialect.childKind(request.scope));
        });
    }

    async profile(dataset: string, options: { signal?: AbortSignal } = {}): Promise<ProfileResult> {
        const { provider } = await this.ensureLive();
        const dialect = provider.dialect;

        const result = await this.call(options.signal, "query-error", async (signal): Promise<ProfileResult> => {
            const columns = await this.describeColumns(provider, dataset, signal);
            if (provider.profile) {
                return { profile: await provider.profile(dataset, signal), derivation: "native" };
            }

            const aggregate = await provider.execute(dialect.profileSql(columns, dataset), { maxRows: 1, signal });
            const profile = profileFromAggregate(columns, aggregate.rows[0] ?? {}, dataset);

            try {
                const samples = await provider.execute(dialect.sampleSql(columns, dataset), { maxRows: 5, signal });
                applySamples(profile, samples.rows);
            } catch (err) {
                if (signal.aborted) throw err;
                // Sampling can fail on restricted columns; the profile is still usable without it.
            }

            return { profile, derivation: `dialect:${dialect.id}` };
        });

        await this.rememberDataset(dataset);
        return result;
    }

    private async rememberDataset(dataset: string): Promise<void> {
        if (!this.live) return;
        const record: SourceRecord = { ...this.live.record, dataset };
        this.live = { provider: this.live.provider, record };
        this.state = { state: "live", record };
        await this.store.write(record).catch(() => undefined);
    }

    async query(sql: string, options: { maxRows?: number; signal?: AbortSignal } = {}): Promise<QueryResult> {
        const { provider, record } = await this.ensureLive();
        if (!provider.dialect.isReadOnly(sql)) {
            throw new SourceError(
                "read-only-violation",
                "Only read-only SQL is permitted (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN).",
                {
                    provider: record.provider,
                    hint: "Rephrase the statement as a query; mutations are blocked for safety.",
                },
            );
        }
        return this.call(options.signal, "query-error", (signal) => provider.execute(sql, {
            ...(options.maxRows !== undefined ? { maxRows: options.maxRows } : {}),
            signal,
        }));
    }

    async metric(spec: MetricSpec, options: { signal?: AbortSignal } = {}): Promise<MetricResult> {
        const { provider, record } = await this.ensureLive();
        const dialect = provider.dialect;
        const dataset = spec.dataset ?? record.dataset;
        if (!dataset) {
            throw new SourceError("not-configured", "No dataset is selected for this metric.", {
                provider: record.provider,
                hint: "Profile a table first, or name one in the request.",
            });
        }

        return this.call(options.signal, "query-error", async (signal): Promise<MetricResult> => {
            if (spec.kind === "correlation") {
                const [colA, colB] = spec.columns;
                const a = dialect.quote(colA);
                const b = dialect.quote(colB);
                const result = await provider.execute(
                    `SELECT COUNT(*) AS n, ${dialect.correlation(a, b)} AS r ` +
                    `FROM ${dialect.qualify(dataset)} WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL`,
                    { maxRows: 1, signal },
                );
                const row = result.rows[0] ?? {};
                const sampleSize = toNumber(row.n) ?? 0;
                const correlation = sampleSize > 1 ? toNumber(row.r) ?? 0 : 0;
                return {
                    kind: "correlation",
                    dataset,
                    columns: [colA, colB],
                    sampleSize,
                    correlation: Number(correlation.toFixed(4)),
                    strength: Math.abs(correlation) > 0.7 ? "strong" : Math.abs(correlation) > 0.4 ? "moderate" : "weak",
                    direction: correlation > 0 ? "positive" : "negative",
                    derivation: `dialect:${dialect.id}`,
                    ...(sampleSize <= 1 ? { note: "Fewer than two complete rows; the correlation is not meaningful." } : {}),
                };
            }

            const id = dialect.quote(spec.column);
            const result = await provider.execute(
                `SELECT COUNT(${id}) AS n, ` +
                `${dialect.percentile(id, 0.25)} AS p25, ${dialect.percentile(id, 0.5)} AS p50, ` +
                `${dialect.percentile(id, 0.75)} AS p75, ${dialect.percentile(id, 0.9)} AS p90, ` +
                `${dialect.percentile(id, 0.99)} AS p99 ` +
                `FROM ${dialect.qualify(dataset)}`,
                { maxRows: 1, signal },
            );
            const row = result.rows[0] ?? {};
            const count = toNumber(row.n) ?? 0;
            if (count === 0) {
                throw new SourceError("query-error", `No numeric values in "${spec.column}".`, {
                    provider: record.provider,
                });
            }
            return {
                kind: "percentiles",
                dataset,
                column: spec.column,
                count,
                p25: toNumber(row.p25),
                p50: toNumber(row.p50),
                p75: toNumber(row.p75),
                p90: toNumber(row.p90),
                p99: toNumber(row.p99),
                derivation: `dialect:${dialect.id}`,
            };
        });
    }

    async close(): Promise<void> {
        this.retired = true;
        this.closed.abort();
        const live = this.live;
        this.live = undefined;
        this.state = { state: "idle" };
        await live?.provider.close().catch(() => undefined);
    }
}

/** One session per conversation, owned by the harness. */
export class DataSourceRegistry {
    private readonly sessions = new Map<string, Session>();

    constructor(private readonly options: DataSourceRegistryOptions) {}

    for(conversationId: string | number): DataSourceSession {
        const key = String(conversationId);
        let session = this.sessions.get(key);
        if (!session) {
            session = new Session(key, this.options);
            this.sessions.set(key, session);
        }
        return session;
    }

    /** Providers a manifest makes available, for `list_data_sources` and the console. */
    providers(): ProviderDescriptor[] {
        return this.options.catalog.list();
    }

    async close(): Promise<void> {
        const all = [...this.sessions.values()];
        this.sessions.clear();
        await Promise.all(all.map((session) => session.close()));
    }
}
