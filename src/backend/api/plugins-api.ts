/**
 * What the console shows about data plugins (docs/plugins.md): the installed manifests, the
 * capabilities each one serves (and which plugin wins them), the agent tools it contributed,
 * and why it is not working when it is not.
 *
 * The plugin rows themselves come from `pluginFacts()` in `src/capabilities/catalog.ts`, which
 * the Capabilities page reads too, so both pages describe one plugin the same way.
 *
 * Shapes are JSON-safe and never throw: a broken manifest becomes an entry in `errors`, so
 * the Settings page can show it instead of the workspace failing to load.
 */
import { pluginFacts, type PluginFacts } from "../../capabilities/catalog";
import type { PluginAgentTools } from "../../plugins/agent-tools";
import { discoverPlugins } from "../../plugins/manifest";
import { discoverPluginHandles } from "../../plugins/runtime";
import type { LoadedPlugin } from "../../plugins/types";

export interface PluginsSummary {
    /** The same plugin facts the Capabilities page shows, one entry per installed manifest. */
    plugins: PluginFacts[];
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
    /** A script plugin publishes capabilities, not tools: nothing to check, not a failure. */
    capabilitiesOnly?: boolean;
    error?: string;
}

/** Best-effort: never throw, return what could be read plus the reason the rest could not. */
export function pluginsSummary(
    loaded?: PluginAgentTools,
    root?: string,
    disabled: readonly string[] = [],
): PluginsSummary {
    const errors: string[] = [...(loaded?.errors ?? [])];
    let installed: LoadedPlugin[] = [];
    try {
        installed = discoverPlugins(root ? { root } : {});
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
    }

    return {
        plugins: pluginFacts(installed, loaded, { disabled }),
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
export async function checkPlugins(timeoutMs?: number): Promise<PluginCheck[]> {
    let discovered;
    try {
        discovered = discoverPluginHandles(timeoutMs !== undefined ? { timeoutMs } : {});
    } catch (err) {
        return [{ name: "(discovery)", ok: false, error: err instanceof Error ? err.message : String(err) }];
    }

    const results: PluginCheck[] = discovered.errors.map((error): PluginCheck => ({
        name: error.plugin ?? "(discovery)",
        ok: false,
        error: error.message,
    }));
    for (const handle of discovered.handles) {
        const name = handle.plugin.manifest.name;
        if (!handle.publishesTools) {
            results.push({ name, ok: true, tools: [], capabilitiesOnly: true });
            continue;
        }
        try {
            results.push({ name, ok: true, tools: (await handle.tools()).map((tool) => tool.name) });
        } catch (err) {
            results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
            await handle.close();
        }
    }
    return results;
}
