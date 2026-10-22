import { discoverPlugins, providers, type DiscoverOptions } from "./manifest";
import { openPluginHandle, type PluginHandle, type PluginRuntimeOptions } from "./runtime";
import { PluginError, type CapabilityId, type LoadedPlugin } from "./types";

export interface ResolveOptions extends DiscoverOptions {
    /** Use this plugin (by name); an error if it does not provide the capability. */
    prefer?: string;
    /** Already-discovered plugins; skips discovery. */
    plugins?: readonly LoadedPlugin[];
    timeoutMs?: number;
    /** How the chosen plugin is opened. Default `openPluginHandle`; a test passes a spy. */
    open?: (plugin: LoadedPlugin, options: PluginRuntimeOptions) => PluginHandle;
}

/** A capability bound to the plugin that will serve it. */
export interface Capability<I, O> {
    id: CapabilityId;
    plugin: LoadedPlugin;
    /** The timeout this capability's plugin starts and answers with (the plugin module's one timeout). */
    timeoutMs: number;
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
 *
 * The plugin is opened through `runtime.ts` and started lazily: resolving a capability that
 * is never called — `evals:compare --builtin` over a directory of installed plugins — starts
 * no process.
 */
export function resolveCapability<I, O>(contract: CapabilityContract<I, O>, options: ResolveOptions = {}): Capability<I, O> | undefined {
    const plugins = options.plugins ?? discoverPlugins(options);
    // DATACLAW_PLUGIN is a soft preference (it may name a plugin for another capability).
    const envPrefer = process.env.DATACLAW_PLUGIN || undefined;
    const soft = envPrefer && plugins.some((p) => p.manifest.name === envPrefer && p.manifest.capabilities.includes(contract.id)) ? envPrefer : undefined;
    const [best] = providers(plugins, contract.id, options.prefer ?? soft);
    if (!best) return undefined;
    const handle = (options.open ?? openPluginHandle)(best, { timeoutMs: options.timeoutMs });
    return {
        id: contract.id,
        plugin: best,
        timeoutMs: handle.timeoutMs,
        async call(input: I): Promise<O> {
            const raw = await handle.invoke(contract.id, contract.toInput(input));
            try {
                return contract.parseOutput(raw);
            } catch (err) {
                throw new PluginError(`output does not match ${contract.id}: ${err instanceof Error ? err.message : String(err)}`, {
                    plugin: best.manifest.name,
                    code: "contract",
                });
            }
        },
        async close() {
            await handle.close();
        },
    };
}
