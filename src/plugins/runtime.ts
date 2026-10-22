/**
 * The plugin module: discovery, startup, timeout, tool listing and invocation, in one place.
 *
 * Two consumers sit above it and neither builds a client of its own:
 *
 * - `agent-tools.ts` projects a plugin's published tool inventory into harness tools, so it
 *   starts eagerly (it needs the schemas before the first turn).
 * - `registry.ts` binds one capability id to a bound call, so it starts lazily: naming a plugin
 *   through `openPluginHandle()` costs nothing, and the first `invoke()` starts it. `evals:compare`
 *   depends on that — comparing two runs must not start every installed plugin.
 *
 * Both get the same timeout (`pluginTimeoutMs()`), the same `PluginError` with a code, and
 * therefore the same message for the same failure. A `script` transport is capabilities-only:
 * it publishes no tool inventory, which is a property of the plugin, never an error.
 */
import { discoverPlugins, type DiscoverOptions } from "./manifest";
import { openMcpPlugin, openPlugin, type McpToolClient, type McpToolDefinition } from "./transports";
import { PluginError, pluginTimeoutMs, type CapabilityId, type LoadedPlugin, type PluginClient, type PluginErrorCode } from "./types";

export interface PluginRuntimeOptions {
    /** Start and call timeout. Default `pluginTimeoutMs()`: 120 s, `DATACLAW_PLUGIN_TIMEOUT_MS`. */
    timeoutMs?: number;
}

/**
 * One plugin as the module sees it. Constructing a handle starts nothing: an MCP client
 * connects on its first `tools()` / `callTool()` / `invoke()`, and a script transport spawns
 * one process per `invoke()`. That is what makes eager and lazy startup the same interface.
 */
export interface PluginHandle {
    readonly plugin: LoadedPlugin;
    /** The timeout every start and call on this handle uses. */
    readonly timeoutMs: number;
    /** False for a `script` transport: it serves capabilities only and publishes no tool inventory. */
    readonly publishesTools: boolean;
    /** The MCP tool client, connected on first use. Undefined when the plugin publishes no tools. */
    mcp(): McpToolClient | undefined;
    /** Start the plugin now and list every tool it publishes. Empty when it publishes none. */
    tools(): Promise<McpToolDefinition[]>;
    /** Call any tool the server lists, by the server's own name. */
    callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
    /** Call a declared capability, starting the plugin on first use. */
    invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown>;
    close(): Promise<void>;
}

/**
 * The one error shape for a plugin failure: a `PluginError` that already names the plugin and
 * its code passes through untouched, anything else is wrapped here, once.
 */
export function pluginFailure(err: unknown, plugin: LoadedPlugin | string | undefined, code: PluginErrorCode): PluginError {
    if (err instanceof PluginError) return err;
    const name = typeof plugin === "string" ? plugin : plugin?.manifest.name;
    return new PluginError(err instanceof Error ? err.message : String(err), name ? { plugin: name, code } : { code });
}

/** Open one plugin. Nothing starts until `tools()` or the first `invoke()`. */
export function openPluginHandle(plugin: LoadedPlugin, options: PluginRuntimeOptions = {}): PluginHandle {
    const timeoutMs = pluginTimeoutMs(options.timeoutMs);
    const name = plugin.manifest.name;
    // Both constructors are free; only a call starts a process.
    const mcp = openMcpPlugin(plugin, { timeoutMs });
    const client: PluginClient = mcp ?? openPlugin(plugin, { timeoutMs });
    return {
        plugin,
        timeoutMs,
        publishesTools: mcp !== undefined,
        mcp: () => mcp,
        async tools() {
            if (!mcp) return [];
            try {
                return await mcp.listToolDefinitions();
            } catch (err) {
                throw pluginFailure(err, name, "startup");
            }
        },
        async callTool(tool, args, options = {}) {
            if (!mcp) throw new PluginError("provides capabilities only: it publishes no tools", { plugin: name, code: "call" });
            try {
                return await mcp.callTool(tool, args, options);
            } catch (err) {
                throw pluginFailure(err, name, "call");
            }
        },
        async invoke(capability, input) {
            try {
                return await client.invoke(capability, input);
            } catch (err) {
                throw pluginFailure(err, name, "call");
            }
        },
        async close() {
            await client.close();
        },
    };
}

export interface PluginHandles {
    /** Every installed plugin, opened but not started. */
    handles: PluginHandle[];
    /** Discovery problems, in the same vocabulary; a bad manifest never stops the others. */
    errors: PluginError[];
}

/** Discovery as the module sees it: one handle per installed plugin, plus what could not be read. */
export function discoverPluginHandles(options: DiscoverOptions & PluginRuntimeOptions = {}): PluginHandles {
    let plugins: LoadedPlugin[];
    try {
        plugins = discoverPlugins(options);
    } catch (err) {
        return { handles: [], errors: [pluginFailure(err, undefined, "manifest")] };
    }
    return { handles: plugins.map((plugin) => openPluginHandle(plugin, options)), errors: [] };
}
