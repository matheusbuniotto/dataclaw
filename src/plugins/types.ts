/**
 * Data plugins: external programs that provide named, versioned capabilities
 * (e.g. `stats.compare_eval_runs@1`) through one interface, whatever their transport.
 * See docs/plugins.md.
 */

/** `<domain>.<name>@<major>`, e.g. `stats.agreement_kappa@1`. */
export type CapabilityId = `${string}.${string}@${number}`;

export interface McpTransportConfig {
    type: "mcp";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    /** Working directory, relative to the manifest file. Defaults to the manifest directory. */
    cwd?: string;
    /** Capability id -> MCP tool name. Defaults to the part between the first "." and "@". */
    tools?: Record<string, string>;
}

export interface ScriptTransportConfig {
    type: "script";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

/** Streamable HTTP MCP. Auth and endpoint come from the environment, never from the manifest. */
export interface HttpMcpTransportConfig {
    type: "mcp-http";
    /** Endpoint URL. `${ENV_VAR}` is expanded when the client opens; a missing variable is an error. */
    url: string;
    /** Sent with every request. Values may reference `${ENV_VAR}`. */
    headers?: Record<string, string>;
    /** Environment variable holding a bearer token. Re-read once after an auth failure. */
    bearerEnv?: string;
    /** Capability id -> MCP tool name. Defaults to the part between the first "." and "@". */
    tools?: Record<string, string>;
}

export type TransportConfig = McpTransportConfig | ScriptTransportConfig | HttpMcpTransportConfig;

/** SQL dialects a data source may declare. Code for each lives in `src/datasource/dialects/`. */
export const DIALECT_NAMES = ["databricks", "snowflake", "bigquery", "ansi"] as const;
export type DialectName = (typeof DIALECT_NAMES)[number];

/** A credential source, by name. The manifest never holds a secret. */
export type DataSourceAuth =
    | { kind: "env"; vars: readonly string[] }
    | { kind: "cli-profile"; default?: string }
    | { kind: "oauth" }
    | { kind: "service-principal" };

/**
 * How read-only is guaranteed. `tool` names the server tool (or argument) that is read-only,
 * `role` declares a server-enforced read-only role, `checked` parses the statement client-side.
 * A data source with none of these is refused at connect.
 */
export interface DataSourceReadOnly {
    mode: "tool" | "role" | "checked";
    /** Tool that is read-only. Defaults to `tools.query`. */
    tool?: string;
    /** When the read-only guarantee is an argument on a tool, its name... */
    argument?: string;
    /** ...and the value that makes the call read-only. */
    value?: boolean | string;
    /** Free text for the record, e.g. the role name. */
    note?: string;
}

/**
 * A plugin that is a data source rather than a capability provider. It is not started at harness
 * open: the data-source session opens it when a conversation connects, so no warehouse is contacted
 * before the user asks.
 */
export interface DataSourceManifest {
    /** SQL dialect the session uses when the server publishes no describe/profile tool. */
    dialect: DialectName;
    /** The server's tool names for the four operations. `query` is required. */
    tools: { query: string; describe?: string; profile?: string; inventory?: string };
    readOnly: DataSourceReadOnly;
    auth?: readonly DataSourceAuth[];
    /** Argument name each tool expects for its statement, when it is not `sql`. */
    arguments?: { query?: string; describe?: string; profile?: string; inventory?: string };
}

export interface PluginManifest {
    name: string;
    version: string;
    description: string;
    /** Free-form area such as "stats", "ml", "forecasting", "fpa". */
    domain: string;
    capabilities: CapabilityId[];
    transport: TransportConfig;
    /** Higher wins when several plugins provide the same capability. Default 0. */
    priority?: number;
    /** Present when this plugin is a data source. See `DataSourceManifest`. */
    dataSource?: DataSourceManifest;
}

export interface LoadedPlugin {
    manifest: PluginManifest;
    /** File the manifest was read from. */
    source: string;
    /** Absolute working directory for the transport. */
    cwd: string;
}

/** What the rest of DataClaw talks to. Transports implement it. */
export interface PluginClient {
    readonly plugin: LoadedPlugin;
    invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown>;
    close(): Promise<void>;
}

export class PluginError extends Error {
    constructor(message: string, readonly plugin?: string) {
        super(plugin ? `[plugin ${plugin}] ${message}` : message);
        this.name = "PluginError";
    }
}
