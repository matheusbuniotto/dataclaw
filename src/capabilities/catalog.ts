/**
 * One place that answers "what can the agent do, and what is switched off".
 *
 * Four kinds of capability show up here — built-in tool groups, plugins (which bring their
 * own tools over MCP or a script), skills (instructions read on demand), and the Databricks
 * MCP data source (informational; it is a connection, not a plugin).
 *
 * Enable/disable is a small durable list at the project root, `dataclaw.capabilities.json`
 * (gitignored), so it survives restarts and applies the next time the harness opens:
 *
 *     { "disabled": ["plugin:teatools", "skill:data-exploration"] }
 *
 * Per-agent selection is the same idea one level up: a conversation's `AgentState` already
 * stores which extensions and tools it runs with (pi-durable resolves them by name), so a
 * later change can toggle a capability for one agent without touching the workspace default
 * recorded here.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ANALYST_TOOLS, CODING_TOOLS } from "../docs/agent-capabilities";
import type { PluginAgentTools } from "../plugins/agent-tools";
import { discoverPlugins, providers, validateManifest } from "../plugins/manifest";
import type { LoadedPlugin, PluginManifest } from "../plugins/types";
import { loadSkills } from "../workspace/context";

export const CAPABILITIES_FILE = "dataclaw.capabilities.json";

export type CapabilityKind = "tools" | "plugin" | "skill" | "mcp";

export interface CapabilityEntry {
    /** `tool:coding`, `plugin:teatools`, `skill:data-exploration`, `mcp:databricks`. */
    id: string;
    kind: CapabilityKind;
    name: string;
    description: string;
    enabled: boolean;
    /** False for capabilities the console only reports (core tools, MCP connections). */
    toggleable: boolean;
    /** Manifest, skill file, or "built in". */
    source: string;
    /** Set when the capability is installed but not working. */
    error?: string;
    /** The plugin projection, for `kind: "plugin"` rows: the same facts `/api/plugins` serves. */
    plugin?: PluginFacts;
    details: {
        version?: string;
        domain?: string;
        transport?: string;
        command?: string;
        tools?: string[];
        capabilities?: { id: string; winner: boolean; shadowedBy?: string }[];
        skillSource?: string;
    };
}

export interface CapabilityCatalog {
    entries: CapabilityEntry[];
    disabled: string[];
    configPath: string;
    errors: string[];
    /** True when plugin tools are loaded through `tool_search` rather than offered up front. */
    deferred: boolean;
    workspaceDir: string;
    projectRoot: string;
}

export interface CatalogOptions {
    projectRoot: string;
    workspaceDir: string;
    /** The harness's loaded plugin tools, when it is open. */
    loaded?: PluginAgentTools;
    /** Manifest-only listing (the harness is closed or plugins are disabled). */
    plugins?: boolean;
    /** Current Databricks data-source state, when the caller knows it. */
    databricks?: { connected: boolean; host?: string; error?: string };
}

export function capabilitiesConfigPath(projectRoot: string): string {
    return resolve(projectRoot, CAPABILITIES_FILE);
}

/** A malformed file is reported, never fatal: an unreadable list disables nothing. */
export function readDisabled(projectRoot: string): { disabled: string[]; errors: string[] } {
    const path = capabilitiesConfigPath(projectRoot);
    if (!existsSync(path)) return { disabled: [], errors: [] };
    try {
        const raw = JSON.parse(readFileSync(path, "utf-8")) as { disabled?: unknown };
        if (!Array.isArray(raw.disabled)) return { disabled: [], errors: [] };
        return { disabled: raw.disabled.filter((id): id is string => typeof id === "string"), errors: [] };
    } catch (err) {
        return { disabled: [], errors: [`${CAPABILITIES_FILE}: ${err instanceof Error ? err.message : String(err)}`] };
    }
}

export function writeDisabled(projectRoot: string, disabled: readonly string[]): string {
    const path = capabilitiesConfigPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    const unique = [...new Set(disabled.map((id) => id.trim()).filter(Boolean))].sort();
    writeFileSync(path, `${JSON.stringify({ disabled: unique }, null, 4)}\n`);
    return path;
}

const disabledSkills = (disabled: readonly string[]): string[] =>
    disabled.filter((id) => id.startsWith("skill:")).map((id) => id.slice("skill:".length));

const disabledPlugins = (disabled: readonly string[]): string[] =>
    disabled.filter((id) => id.startsWith("plugin:")).map((id) => id.slice("plugin:".length));

export function disabledPluginNames(disabled: readonly string[]): string[] {
    return disabledPlugins(disabled);
}

/** Is `plugin:<name>` switched off? */
export function pluginDisabled(disabled: readonly string[], name: string): boolean {
    return disabled.includes(`plugin:${name}`);
}

/**
 * A plugin as the console describes it. The Settings page and the Capabilities page used to
 * project the same `LoadedPlugin` through different field names; this is that one projection.
 */
export interface PluginFacts {
    name: string;
    version: string;
    description: string;
    domain: string;
    transport: "mcp" | "mcp-http" | "script";
    priority: number;
    /** Capability ids the manifest serves, and whether this plugin wins each of them. */
    capabilities: { id: string; winner: boolean; shadowedBy?: string }[];
    /** Agent tools: the name the model calls, and the MCP tool behind it. */
    tools: { name: string; tool: string }[];
    /** How the transport starts, as a command line. */
    command: string;
    /** Manifest file it was read from. */
    source: string;
    /**
     * `ready`: the harness loaded it and its tools exist. `capabilities-only`: a script plugin,
     * which publishes no tools by design. `declared`: manifest only, nothing loaded it.
     */
    status: "ready" | "declared" | "capabilities-only";
    /** True for a script plugin: it serves capabilities, not agent tools. */
    capabilitiesOnly?: boolean;
    error?: string;
}

/**
 * One projection of `LoadedPlugin` for both `/api/plugins` and the capability catalog. `loaded`
 * is the harness's plugin tools when it is open; without it every plugin is `declared`.
 */
export function pluginFacts(
    installed: readonly LoadedPlugin[],
    loaded?: PluginAgentTools,
    options: { disabled?: readonly string[] } = {},
): PluginFacts[] {
    const summaries = new Map((loaded?.plugins ?? []).map((plugin) => [plugin.name, plugin]));
    return installed.map((plugin): PluginFacts => {
        const manifest = plugin.manifest;
        const summary = summaries.get(manifest.name);
        const tools = (summary?.tools ?? []).map((name, index) => ({
            name,
            tool: summary?.mcpTools?.[index] ?? name.replace(`${manifest.name}__`, ""),
        }));
        const capabilitiesOnly = summary?.capabilitiesOnly ?? false;
        // Two healthy cases have no summary by design: a data source plugin (opened by the
        // session, not the tool bridge) and a plugin the user switched off. Neither is broken.
        const expected = Boolean(manifest.dataSource) || pluginDisabled(options.disabled ?? [], manifest.name);
        const error = loaded?.errors.find((message) => message.startsWith(`[plugin ${manifest.name}]`))
            ?? (summary || expected ? undefined : "declared but not loaded by the harness");
        // An MCP-over-HTTP plugin has no command line; its endpoint is what runs it.
        const command = manifest.transport.type === "mcp-http"
            ? manifest.transport.url
            : [manifest.transport.command, ...(manifest.transport.args ?? [])].join(" ");
        return {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            domain: manifest.domain,
            transport: manifest.transport.type,
            priority: manifest.priority ?? 0,
            capabilities: manifest.capabilities.map((id) => {
                let winner: LoadedPlugin | undefined;
                try {
                    [winner] = providers(installed, id);
                } catch {
                    winner = undefined;
                }
                const isWinner = winner?.manifest.name === manifest.name;
                return {
                    id,
                    winner: isWinner,
                    ...(!isWinner && winner ? { shadowedBy: winner.manifest.name } : {}),
                };
            }),
            tools,
            command,
            source: plugin.source,
            status: capabilitiesOnly ? "capabilities-only" : summary && tools.length > 0 ? "ready" : "declared",
            ...(capabilitiesOnly ? { capabilitiesOnly: true } : {}),
            ...(error ? { error } : {}),
        };
    });
}

function pluginEntries(installed: readonly LoadedPlugin[], loaded?: PluginAgentTools, disabled: readonly string[] = []): CapabilityEntry[] {
    return pluginFacts(installed, loaded, { disabled }).map((facts): CapabilityEntry => ({
        id: `plugin:${facts.name}`,
        kind: "plugin",
        name: facts.name,
        description: facts.description,
        enabled: !pluginDisabled(disabled, facts.name),
        toggleable: true,
        source: facts.source,
        ...(facts.error ? { error: facts.error } : {}),
        plugin: facts,
        details: {
            version: facts.version,
            domain: facts.domain,
            transport: facts.transport,
            command: facts.command,
            // The names the model calls, so a row here matches the agent's own tool allowlist.
            tools: facts.tools.map((tool) => tool.name),
            capabilities: facts.capabilities,
        },
    }));
}

/**
 * Everything installed, whether it is on, and why the broken parts are broken. Never throws:
 * a manifest that cannot be read becomes an entry in `errors` plus a disabled-looking row.
 */
export async function capabilityCatalog(options: CatalogOptions): Promise<CapabilityCatalog> {
    const { projectRoot, workspaceDir } = options;
    const read = readDisabled(projectRoot);
    const errors = [...read.errors];
    const disabled = read.disabled;

    let installed: LoadedPlugin[] = [];
    try {
        installed = discoverPlugins({ root: projectRoot });
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
    }

    const skills = await loadSkills({ workspaceDir, projectRoot });
    const status = options.databricks ?? { connected: false };

    const entries: CapabilityEntry[] = [
        {
            id: "tool:analyst",
            kind: "tools",
            name: "Analyst tools",
            description: "Dataset profiling, read-only SQL, hypotheses, findings, playbook, auditor review.",
            enabled: true,
            toggleable: false,
            source: "src/extensions/analyst-extension.ts",
            // Derived from src/tools/inventory.ts: the analyst capability's own tools plus the
            // source-neutral data tools it installs, so the row cannot drift from the extension.
            details: { tools: [...ANALYST_TOOLS] },
        },
        {
            id: "tool:coding",
            kind: "tools",
            name: "File and shell tools",
            description: "read, write, edit and bash inside the agent workspace. Turn off to keep the agent read-only by design.",
            enabled: !disabled.includes("tool:coding"),
            toggleable: true,
            source: "@earendil-works/pi-durable/tools",
            details: { tools: [...CODING_TOOLS] },
        },
        {
            id: "tool:tool-search",
            kind: "tools",
            name: "Tool search",
            description: "Lets the model load deferred plugin tools by name instead of carrying every schema in each request.",
            enabled: options.loaded?.deferred ?? true,
            toggleable: false,
            source: "src/harness.ts",
            details: {},
        },
        {
            id: "mcp:databricks",
            kind: "mcp",
            name: "Databricks SQL MCP",
            description: "Managed read-only SQL over Unity Catalog, attached as a data source.",
            enabled: status.connected,
            toggleable: false,
            source: "src/mcp/mcp-sql-client.ts",
            ...(status.connected ? {} : { error: status.error ?? "not connected" }),
            details: { transport: "http", ...(status.host ? { command: status.host } : {}) },
        },
        ...pluginEntries(installed, options.loaded, disabled),
        ...skills.map((skill): CapabilityEntry => ({
            id: `skill:${skill.name}`,
            kind: "skill",
            name: skill.name,
            description: skill.description,
            enabled: !disabledSkills(disabled).includes(skill.name),
            toggleable: true,
            source: skill.location,
            details: { skillSource: skill.source },
        })),
    ];

    return {
        entries,
        disabled,
        configPath: capabilitiesConfigPath(projectRoot),
        errors,
        deferred: options.loaded?.deferred ?? true,
        workspaceDir,
        projectRoot,
    };
}

export interface AddedPlugin {
    name: string;
    path: string;
    manifest: PluginManifest;
}

function projectPluginDir(projectRoot: string, name: string): string {
    return join(projectRoot, "plugins", name);
}

/** Validate a manifest and write it to `plugins/<name>/plugin.json`. */
export function addPlugin(projectRoot: string, raw: unknown): AddedPlugin {
    if (!raw || typeof raw !== "object") throw new Error("manifest must be a JSON object");
    const path = join(projectPluginDir(projectRoot, String((raw as { name?: unknown }).name ?? "")), "plugin.json");
    // validateManifest names the source in every error message.
    const manifest = validateManifest(raw, path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 4)}\n`);
    return { name: manifest.name, path, manifest };
}

/**
 * Delete `plugins/<name>`, and only there: a manifest that came from `DATACLAW_PLUGIN_PATH`
 * or `dataclaw.plugins.json` belongs to whoever wrote it, and the UI does not touch it.
 */
export function removePlugin(projectRoot: string, name: string): void {
    if (!/^[a-z0-9][a-z0-9_.-]*$/.test(name)) throw new Error(`invalid plugin name "${name}"`);
    const dir = projectPluginDir(projectRoot, name);
    if (!existsSync(join(dir, "plugin.json"))) {
        throw new Error(`plugin "${name}" is not installed in plugins/ under this project`);
    }
    rmSync(dir, { recursive: true, force: true });
}

const SKILL_NAME = /^[a-z0-9][a-z0-9_.-]*$/;

/** Write `skills/<name>/SKILL.md` in the workspace, the same shape as a hand-written skill. */
export function addSkill(workspaceDir: string, input: { name?: unknown; description?: unknown; body?: unknown }): { name: string; path: string } {
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, "-").toLowerCase() : "";
    if (!SKILL_NAME.test(name)) throw new Error("skill name must be lowercase letters, digits, dots, dashes or underscores");
    const description = typeof input.description === "string" ? input.description.trim().replace(/\s+/g, " ") : "";
    if (!description) throw new Error("a skill needs a one-line description: that is what the agent scans");
    const body = typeof input.body === "string" && input.body.trim() ? input.body.trim() : `# ${name}\n`;
    const dir = join(workspaceDir, "skills", name);
    const path = join(dir, "SKILL.md");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
    return { name, path };
}

/** Remove a skill, only from the workspace's own `skills/` directory. */
export function removeSkill(workspaceDir: string, name: string): void {
    if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`);
    const dir = join(workspaceDir, "skills", name);
    const rel = relative(join(workspaceDir, "skills"), dir);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) throw new Error(`invalid skill name "${name}"`);
    if (!existsSync(join(dir, "SKILL.md"))) throw new Error(`skill "${name}" is not installed in ${join(workspaceDir, "skills")}`);
    rmSync(dir, { recursive: true, force: true });
}

/** Toggle one capability in the durable list. Returns the new list. */
export function setCapabilityEnabled(projectRoot: string, id: string, enabled: boolean): string[] {
    if (!/^(tool|plugin|skill|mcp):[a-z0-9][a-z0-9_.:-]*$/.test(id)) throw new Error(`invalid capability id "${id}"`);
    if (id.startsWith("mcp:")) throw new Error("MCP connections are configured, not toggled");
    if (id === "tool:analyst" || id === "tool:tool-search") throw new Error(`${id} is core to this agent and cannot be disabled`);
    const { disabled } = readDisabled(projectRoot);
    const next = enabled ? disabled.filter((entry) => entry !== id) : [...disabled.filter((entry) => entry !== id), id];
    writeDisabled(projectRoot, next);
    return next;
}
