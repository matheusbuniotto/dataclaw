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

export type TransportConfig = McpTransportConfig | ScriptTransportConfig;

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
