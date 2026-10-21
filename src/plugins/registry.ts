import { discoverPlugins, providers, type DiscoverOptions } from "./manifest";
import { openPlugin } from "./transports";
import { PluginError, type CapabilityId, type LoadedPlugin, type PluginClient } from "./types";

export interface ResolveOptions extends DiscoverOptions {
    /** Use this plugin (by name); an error if it does not provide the capability. */
    prefer?: string;
    /** Already-discovered plugins; skips discovery. */
    plugins?: readonly LoadedPlugin[];
    timeoutMs?: number;
}

/** A capability bound to the plugin that will serve it. */
export interface Capability<I, O> {
    id: CapabilityId;
    plugin: LoadedPlugin;
    call(input: I): Promise<O>;
    close(): Promise<void>;
}

export interface CapabilityContract<I, O> {
    id: CapabilityId;
    /** Throws a descriptive Error when the plugin's output does not match the contract. */
    parseOutput(raw: unknown): O;
    /** Keeps only the documented input fields. */
    toInput(input: I): Record<string, unknown>;
}

/**
 * Bind `contract` to the best installed provider, or return undefined when none is
 * installed so the caller can fall back to its built-in TypeScript implementation.
 */
export function resolveCapability<I, O>(contract: CapabilityContract<I, O>, options: ResolveOptions = {}): Capability<I, O> | undefined {
    const plugins = options.plugins ?? discoverPlugins(options);
    // DATACLAW_PLUGIN is a soft preference (it may name a plugin for another capability).
    const envPrefer = process.env.DATACLAW_PLUGIN || undefined;
    const soft = envPrefer && plugins.some((p) => p.manifest.name === envPrefer && p.manifest.capabilities.includes(contract.id)) ? envPrefer : undefined;
    const [best] = providers(plugins, contract.id, options.prefer ?? soft);
    if (!best) return undefined;
    let client: PluginClient | undefined;
    return {
        id: contract.id,
        plugin: best,
        async call(input: I): Promise<O> {
            client ??= openPlugin(best, { timeoutMs: options.timeoutMs });
            const raw = await client.invoke(contract.id, contract.toInput(input));
            try {
                return contract.parseOutput(raw);
            } catch (err) {
                throw new PluginError(`output does not match ${contract.id}: ${err instanceof Error ? err.message : String(err)}`, best.manifest.name);
            }
        },
        async close() {
            await client?.close();
            client = undefined;
        },
    };
}
