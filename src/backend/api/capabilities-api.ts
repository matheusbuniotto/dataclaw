/**
 * The console's capability manager: list what the agent can do, switch parts of it on or off,
 * add a plugin or a skill, and apply the change to the running agent.
 *
 * Every mutation writes durable state at the project root (`dataclaw.capabilities.json`,
 * `plugins/<name>/plugin.json`, `workspace/skills/<name>/SKILL.md`); nothing lives only in
 * memory. `applyCapabilities()` closes and reopens the harness so a new plugin's tools and a
 * new skill's instructions exist before the next turn.
 *
 * Inputs arrive already coerced by the route; what the catalog refuses is the caller's mistake,
 * so it is thrown as a `ValidationError` (400) or, while a turn is running, a `ConflictError`.
 */
import {
    addPlugin,
    addSkill,
    capabilityCatalog,
    removePlugin,
    removeSkill,
    setCapabilityEnabled,
    type CapabilityCatalog,
} from "../../capabilities/catalog";
import { getDatabricksUiStatus } from "./databricks-api";
import { consoleHarness, reloadConsoleHarness } from "./workspace";
import { ConflictError, ValidationError } from "./wire";
import type { WorkspaceSnapshot } from "../state/workspace-types";

type AnalystHarness = Awaited<ReturnType<typeof consoleHarness>>;

/** The catalog refuses a change with a plain error; every refusal it makes is the caller's. */
function validated<T>(work: () => T): T {
    try {
        return work();
    } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
}

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

export async function toggleCapability(input: { id: string; enabled: boolean }): Promise<CapabilityCatalog> {
    const analyst = await consoleHarness();
    validated(() => setCapabilityEnabled(analyst.projectRoot, input.id, input.enabled));
    return catalogFor(analyst);
}

export async function installPlugin(manifest: unknown): Promise<{ name: string; path: string; capabilities: CapabilityCatalog }> {
    const analyst = await consoleHarness();
    const added = validated(() => addPlugin(analyst.projectRoot, manifest));
    return { capabilities: await catalogFor(analyst), name: added.name, path: added.path };
}

export async function uninstallPlugin(name: string): Promise<CapabilityCatalog> {
    const analyst = await consoleHarness();
    validated(() => removePlugin(analyst.projectRoot, name));
    return catalogFor(analyst);
}

export async function installSkill(input: { name?: string; description?: string; body?: string }): Promise<{ name: string; path: string; capabilities: CapabilityCatalog }> {
    const analyst = await consoleHarness();
    const added = validated(() => addSkill(analyst.workspaceDir, input));
    return { capabilities: await catalogFor(analyst), name: added.name, path: added.path };
}

export async function uninstallSkill(name: string): Promise<CapabilityCatalog> {
    const analyst = await consoleHarness();
    validated(() => removeSkill(analyst.workspaceDir, name));
    return catalogFor(analyst);
}

/** The harness refuses to reopen while a turn is running; that refusal is a conflict, not a crash. */
export const AGENT_BUSY = "DataClaw is working. Stop the turn before applying capability changes.";

/** Reopen the harness so the next turn runs with exactly the capabilities that are enabled. */
export async function applyCapabilities(): Promise<{ workspace: WorkspaceSnapshot; capabilities: CapabilityCatalog }> {
    let workspace: WorkspaceSnapshot;
    try {
        workspace = await reloadConsoleHarness();
    } catch (err) {
        if (err instanceof Error && err.message === AGENT_BUSY) throw new ConflictError(AGENT_BUSY);
        throw err;
    }
    return { workspace, capabilities: await catalogFor(await consoleHarness()) };
}
