/**
 * The data-source session: one live source per conversation, and the ports behind it.
 *
 * A session owns which source is live (`status`, `connect`, `close`), and every read a tool makes
 * of it (`discover`, `profile`, `query`, `metric`). A **provider** reaches one kind of source over
 * its transport; a **dialect** generates that source's SQL. Neither is visible to a tool or to the
 * console.
 *
 * Invariants the implementation must keep (they are part of this interface):
 *
 * 1. At most one live source per conversation. A failed `connect` leaves the previous one live and
 *    the durable record untouched.
 * 2. `connect` writes the plan record last, after the provider proves its declared tools exist and
 *    its read-only mode is available. A record is enough to reconnect; it never holds a secret.
 * 3. `status()` never throws: it is the console's and the prompt's read path.
 * 4. Every operation is read-only by contract. A provider refuses a mutating statement before it
 *    reaches the transport, and the transport's own read-only mode refuses it again.
 * 5. Abort is a parameter on each call, never session state, so two concurrent calls cannot trade
 *    signals.
 * 6. Every profile and metric carries `derivation`, so a number produced from generated SQL is not
 *    mistaken for one a server computed.
 */
import type { DatasetProfile, QueryResult } from "../adapters/adapter-interface";
import type { DialectName } from "../plugins/types";

/** The three column kinds a profile reports. The dialect maps native types onto them. */
export type ColumnKind = "INTEGER" | "REAL" | "TEXT";

export interface ColumnTraits {
    kind: ColumnKind;
    numeric: boolean;
    temporal: boolean;
}

export interface DescribedColumn extends ColumnTraits {
    name: string;
    dataType: string;
}

/**
 * Where a result came from: the server's own tool, or SQL this project generated from a dialect.
 * Shown next to the number, the same way a plugin reports its `method`.
 */
export type Derivation = "native" | `dialect:${DialectName}`;

// ---------------------------------------------------------------------------
// The durable record
// ---------------------------------------------------------------------------

/** A credential *source*, by name. Never a token. */
export interface SourceCredential {
    kind: "env" | "cli-profile" | "oauth" | "service-principal";
    /** CLI profile name, for `kind: "cli-profile"`. */
    profile?: string;
}

/** Exactly what `AnalystPlanDoc.dataSource` stores. Everything here is safe to persist. */
export interface SourceRecord {
    provider: string;
    dialect: DialectName;
    endpoint?: string;
    /** Namespace parts above the dataset, in the source's own order. */
    namespace?: readonly string[];
    /** The dataset in focus, when one has been selected. */
    dataset?: string;
    credential?: SourceCredential;
    connectedAt: number;
}

export interface ConnectIntent {
    provider: string;
    credential?: SourceCredential;
    /** Overrides the manifest's endpoint for this connection. */
    endpoint?: string;
    /** Selects a dataset immediately after connecting. */
    dataset?: string;
}

/** What `status()` returns. `connecting` exists so the console can render before auth finishes. */
export type SourceStatus =
    | { state: "idle" }
    | { state: "connecting"; provider: string }
    | { state: "live"; record: SourceRecord }
    | { state: "failed"; provider: string; error: SourceError };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Namespace parts above a dataset: catalog.schema, database.schema, project.dataset. */
export interface DatasetScope {
    namespace?: readonly string[];
}

export interface Discovery {
    name: string;
    kind: "namespace" | "dataset" | "column";
    /** Data type for a column, table type for a dataset. */
    detail?: string;
}

/**
 * Listing is one verb with two branches: the level below a scope, or the columns of a dataset.
 * `children` with no scope lists the top level; each namespace part descends one level.
 */
export type DiscoveryRequest =
    | { step: "children"; scope?: DatasetScope }
    | { step: "columns"; dataset: string };

export interface ProfileResult {
    profile: DatasetProfile;
    derivation: Derivation;
}

export type MetricSpec =
    | { kind: "correlation"; dataset?: string; columns: readonly [string, string] }
    | { kind: "percentiles"; dataset?: string; column: string };

export interface CorrelationMetric {
    kind: "correlation";
    dataset: string;
    columns: readonly [string, string];
    sampleSize: number;
    correlation: number;
    strength: "weak" | "moderate" | "strong";
    direction: "positive" | "negative";
    derivation: Derivation;
}

export interface PercentileMetric {
    kind: "percentiles";
    dataset: string;
    column: string;
    count: number;
    p25: number | undefined;
    p50: number | undefined;
    p75: number | undefined;
    p90: number | undefined;
    p99: number | undefined;
    derivation: Derivation;
}

export type MetricResult = CorrelationMetric | PercentileMetric;

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Loading a local file into a local dataset. Only a local provider offers this. */
export interface DatasetIntake {
    loadCsv(table: string, content: string): Promise<DatasetProfile>;
    loadJson(table: string, content: string): Promise<DatasetProfile>;
}

/** How read-only is guaranteed on this connection, proven by `probe()`. */
export type ReadOnlyMode = "tool" | "role" | "checked";

export interface ProviderProbe {
    /** The tools the server actually listed, for checking the manifest's declared names. */
    tools: readonly string[];
    readOnly: ReadOnlyMode;
}

/**
 * One kind of data source, over one transport. Presence of an optional method *is* the capability:
 * no `describe` means the session uses the dialect's `describeSql`.
 */
export interface DataProvider {
    readonly id: string;
    readonly dialect: Dialect;
    /** A local provider always has `intake`; a remote one never does. */
    readonly kind: "local" | "remote";
    probe(): Promise<ProviderProbe>;
    execute(sql: string, options?: { maxRows?: number; signal?: AbortSignal }): Promise<QueryResult>;
    inventory?(scope: DatasetScope | undefined, signal?: AbortSignal): Promise<Discovery[]>;
    describe?(dataset: string, signal?: AbortSignal): Promise<DescribedColumn[]>;
    profile?(dataset: string, signal?: AbortSignal): Promise<DatasetProfile>;
    readonly intake?: DatasetIntake;
    close(): Promise<void>;
}

/**
 * The SQL a source speaks. Pure: same input, same string, no I/O. `scope.namespace.length` decides
 * which level `listChildrenSql` lists.
 *
 * `profileSql` must alias its aggregate columns so the session can read them back:
 * `__row_count`, and for the column at index `i` — `c{i}__non_null`, `c{i}__distinct`, plus
 * `c{i}__min`, `c{i}__max`, `c{i}__mean`, `c{i}__median` where the type allows it.
 */
export interface Dialect {
    readonly id: DialectName;
    quote(identifier: string): string;
    /** Validate and quote every part of `catalog.schema.table`. Throws on an empty or unsafe part. */
    qualify(dataset: string): string;
    split(dataset: string): string[];
    listChildrenSql(scope?: DatasetScope): string;
    describeSql(dataset: string): string;
    profileSql(columns: readonly DescribedColumn[], dataset: string): string;
    percentile(expression: string, p: number): string;
    correlation(a: string, b: string): string;
    castDouble(expression: string): string;
    classify(dataType: string): ColumnTraits;
    isReadOnly(sql: string): boolean;
}

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

/** The closed set of ways a data-source call fails. */
export type SourceErrorCode =
    | "no-session"
    | "not-configured"
    | "auth-expired"
    | "auth-denied"
    | "read-only-violation"
    | "read-only-unavailable"
    | "unsupported-capability"
    | "dialect-missing"
    | "query-error"
    | "transport"
    | "aborted";

/** Retrying without a new credential or a change in the source only helps for these. */
const RETRYABLE: ReadonlySet<SourceErrorCode> = new Set<SourceErrorCode>([
    "auth-expired",
    "transport",
    "aborted",
]);

export interface SourceErrorDetails {
    provider?: string;
    /** What the caller can do about it. Shown verbatim to the model. */
    hint?: string;
    /** The server's real tool list, when a declared tool was missing. */
    available?: readonly string[];
    cause?: unknown;
}

export class SourceError extends Error {
    readonly provider: string | undefined;
    readonly hint: string | undefined;
    readonly available: readonly string[] | undefined;

    constructor(
        readonly code: SourceErrorCode,
        message: string,
        details: SourceErrorDetails = {},
    ) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = "SourceError";
        this.provider = details.provider;
        this.hint = details.hint;
        this.available = details.available;
    }

    get retryable(): boolean {
        return RETRYABLE.has(this.code);
    }
}

// ---------------------------------------------------------------------------
// What callers see
// ---------------------------------------------------------------------------

/**
 * One per conversation. Tools and the console hold this, never a provider, a transport or a
 * dialect. `intake` is present only when the live provider is local.
 */
export interface DataSourceSession {
    readonly providerId: string;
    status(): SourceStatus;
    connect(intent: ConnectIntent): Promise<SourceRecord>;
    close(): Promise<void>;
    discover(request: DiscoveryRequest): Promise<Discovery[]>;
    profile(dataset: string): Promise<ProfileResult>;
    query(sql: string, options?: { maxRows?: number; signal?: AbortSignal }): Promise<QueryResult>;
    metric(spec: MetricSpec): Promise<MetricResult>;
    readonly intake?: DatasetIntake;
}
