/**
 * The bridge between the agent's self-extension tools and the live harness.
 *
 * Tools are defined before a Harness exists, so `features_apply` cannot reach the registry on
 * its own. `createAnalystHarness()` installs a runtime here after it opens: `reload()` starts
 * newly installed plugins, swaps their extensions into the registry, and reconfigures roster
 * agents so a capability added after an agent was created still reaches it.
 */
import type { PluginAgentToolsSummary } from "../plugins/agent-tools";

export interface FeatureReloadResult {
    /** Plugins that are now connected, with the tools they publish. */
    plugins: PluginAgentToolsSummary[];
    /** Plugin problems; a broken plugin is reported, never fatal. */
    errors: string[];
    /** Roster agents whose conversation was reconfigured against the new registry. */
    agentsUpdated: string[];
    /** Every plugin tool currently installed. */
    toolNames: string[];
}

export interface FeatureRuntime {
    projectRoot: string;
    workspaceDir: string;
    /** Tool names of the plugin tools currently installed. */
    pluginToolNames(): readonly string[];
    /** Errors from the last plugin connection attempt. */
    pluginErrors(): readonly string[];
    /** Reload plugin extensions and re-resolve roster profiles. */
    reload(): Promise<FeatureReloadResult>;
}

let runtime: FeatureRuntime | undefined;

export function setFeatureRuntime(next: FeatureRuntime | undefined): void {
    runtime = next;
}

export function currentFeatureRuntime(): FeatureRuntime | undefined {
    return runtime;
}
