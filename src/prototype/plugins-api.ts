/**
 * What the console shows about data plugins (docs/plugins.md): the installed manifests, the
 * capabilities each one serves (and which plugin wins them), the agent tools it contributed,
 * and why it is not working when it is not.
 *
 * Shapes are JSON-safe and never throw: a broken manifest becomes an entry in `errors`, so
 * the Settings page can show it instead of the workspace failing to load.
 */
import type { PluginAgentTools, PluginAgentToolsSummary } from "../plugins/agent-tools";
import { discoverPlugins, providers } from "../plugins/manifest";
import { McpPluginClient } from "../plugins/transports";
import type { LoadedPlugin } from "../plugins/types";

export interface WorkspacePluginCapability {
    id: string;
    /** False when another installed plugin wins this capability. */
    winner: boolean;
    shadowedBy?: string;
}

export interface WorkspacePluginTool {
    /** Harness tool name, `<plugin>__<tool>`, what the transcript shows. */
    name: string;
    /** The MCP tool's own name on the plugin's server. */
    tool: string;
}

export interface WorkspacePluginInfo {
    name: string;
    version: string;
    description: string;
    domain: string;
    transport: "mcp" | "script";
    priority: number;
    capabilities: WorkspacePluginCapability[];
    tools: WorkspacePluginTool[];
    /** Manifest file it was read from. */
    source: string;
    /** `ready`: the harness loaded it and its tools exist. `declared`: manifest only. */
    status: "ready" | "declared";
    error?: string;
}

export interface PluginsSummary {
    plugins: WorkspacePluginInfo[];
    /** Discovery and startup problems, shown verbatim in Settings. */
    errors: string[];
    /** Where DataClaw looks for manifests. */
    searchPaths: string[];
    /** True when tools are loaded through `tool_search` instead of being offered up front. */
    deferred: boolean;
}

export interface PluginCheck {
    name: string;
    ok: boolean;
    tools?: string[];
    error?: string;
}

function capabilitiesFor(installed: readonly LoadedPlugin[], plugin: LoadedPlugin): WorkspacePluginCapability[] {
    return plugin.manifest.capabilities.map((id) => {
        let winner: LoadedPlugin | undefined;
        try {
            [winner] = providers(installed, id);
        } catch {
            winner = undefined;
        }
        const isWinner = winner?.manifest.name === plugin.manifest.name;
        return {
            id,
            winner: isWinner,
            ...(!isWinner && winner ? { shadowedBy: winner.manifest.name } : {}),
        };
    });
}

/** Best-effort: never throw, return what could be read plus the reason the rest could not. */
export function pluginsSummary(loaded?: PluginAgentTools, root?: string): PluginsSummary {
    const errors: string[] = [...(loaded?.errors ?? [])];
    let installed: LoadedPlugin[] = [];
    try {
        installed = discoverPlugins(root ? { root } : {});
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
    }

    const byName = new Map<string, PluginAgentToolsSummary>((loaded?.plugins ?? []).map((p) => [p.name, p]));
    const plugins = installed.map((plugin): WorkspacePluginInfo => {
        const manifest = plugin.manifest;
        const summary = byName.get(manifest.name);
        const tools = (summary?.tools ?? []).map((name, index) => ({
            name,
            tool: summary?.mcpTools?.[index] ?? name.replace(`${manifest.name}__`, ""),
        }));
        const error = errors.find((message) => message.includes(manifest.name));
        return {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            domain: manifest.domain,
            transport: manifest.transport.type,
            priority: manifest.priority ?? 0,
            capabilities: capabilitiesFor(installed, plugin),
            tools,
            source: plugin.source,
            status: summary && tools.length > 0 ? "ready" : "declared",
            ...(summary ? {} : { error: error ?? "declared but not loaded by the harness" }),
        };
    });

    return {
        plugins,
        errors,
        searchPaths: [
            "plugins/<name>/plugin.json",
            "dataclaw.plugins.json",
            ...(process.env.DATACLAW_PLUGIN_PATH ?? "").split(":").filter(Boolean),
        ],
        deferred: loaded?.deferred ?? true,
    };
}

/**
 * Start each MCP plugin, list its tools, stop it. The console's twin of
 * `bun run plugins:list --check`; kept off the page load because it spawns processes.
 */
export async function checkPlugins(timeoutMs = 20_000): Promise<PluginCheck[]> {
    let installed: LoadedPlugin[];
    try {
        installed = discoverPlugins();
    } catch (err) {
        return [{ name: "(discovery)", ok: false, error: err instanceof Error ? err.message : String(err) }];
    }

    const results: PluginCheck[] = [];
    for (const plugin of installed) {
        const name = plugin.manifest.name;
        if (plugin.manifest.transport.type !== "mcp") {
            results.push({ name, ok: true, tools: [], error: "script plugin: capabilities only, no tools to check" });
            continue;
        }
        const client = new McpPluginClient(plugin, timeoutMs);
        try {
            results.push({ name, ok: true, tools: await client.listTools() });
        } catch (err) {
            results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
            await client.close();
        }
    }
    return results;
}
