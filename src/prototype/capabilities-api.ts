/**
 * The console's capability manager: list what the agent can do, switch parts of it on or off,
 * add a plugin or a skill, and apply the change to the running agent.
 *
 * Every mutation writes durable state at the project root (`dataclaw.capabilities.json`,
 * `plugins/<name>/plugin.json`, `workspace/skills/<name>/SKILL.md`); nothing lives only in
 * memory. `applyCapabilities()` closes and reopens the harness so a new plugin's tools and a
 * new skill's instructions exist before the next turn.
 */
import {
    addPlugin,
    addSkill,
    capabilityCatalog,
    removePlugin,
    removeSkill,
    setCapabilityEnabled,
    type CapabilityCatalog,
} from "../capabilities/catalog";
import { getDatabricksUiStatus } from "./databricks-api";
import { consoleHarness, reloadConsoleHarness } from "./workspace";
import type { WorkspaceSnapshot } from "./workspace-types";

type AnalystHarness = Awaited<ReturnType<typeof consoleHarness>>;

async function catalogFor(analyst: AnalystHarness): Promise<CapabilityCatalog> {
    const status = getDatabricksUiStatus();
    return capabilityCatalog({
        projectRoot: analyst.projectRoot,
        workspaceDir: analyst.workspaceDir,
        loaded: analyst.pluginTools,
        databricks: {
            connected: status.connected,
            ...(status.host ? { host: status.host } : {}),
            ...(status.error ? { error: status.error } : {}),
        },
    });
}

export async function capabilitiesCatalog(): Promise<CapabilityCatalog> {
    return catalogFor(await consoleHarness());
}

export async function toggleCapability(input: { id?: unknown; enabled?: unknown }): Promise<CapabilityCatalog> {
    const id = typeof input.id === "string" ? input.id : "";
    if (!id) throw new Error("a capability id is required");
    if (typeof input.enabled !== "boolean") throw new Error("\"enabled\" must be true or false");
    const analyst = await consoleHarness();
    setCapabilityEnabled(analyst.projectRoot, id, input.enabled);
    return catalogFor(analyst);
}

export async function installPlugin(manifest: unknown): Promise<{ catalog: CapabilityCatalog; name: string; path: string }> {
    const analyst = await consoleHarness();
    const added = addPlugin(analyst.projectRoot, manifest);
    return { catalog: await catalogFor(analyst), name: added.name, path: added.path };
}

export async function uninstallPlugin(name: string): Promise<CapabilityCatalog> {
    const analyst = await consoleHarness();
    if (!name) throw new Error("a plugin name is required");
    removePlugin(analyst.projectRoot, name);
    return catalogFor(analyst);
}

export async function installSkill(input: { name?: unknown; description?: unknown; body?: unknown }): Promise<{ catalog: CapabilityCatalog; name: string; path: string }> {
    const analyst = await consoleHarness();
    const added = addSkill(analyst.workspaceDir, input);
    return { catalog: await catalogFor(analyst), name: added.name, path: added.path };
}

export async function uninstallSkill(name: string): Promise<CapabilityCatalog> {
    const analyst = await consoleHarness();
    if (!name) throw new Error("a skill name is required");
    removeSkill(analyst.workspaceDir, name);
    return catalogFor(analyst);
}

/** Reopen the harness so the next turn runs with exactly the capabilities that are enabled. */
export async function applyCapabilities(): Promise<{ workspace: WorkspaceSnapshot; capabilities: CapabilityCatalog }> {
    const workspace = await reloadConsoleHarness();
    return { workspace, capabilities: await catalogFor(await consoleHarness()) };
}
