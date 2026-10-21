/**
 * What a specialist is allowed to do.
 *
 * A roster agent stores capability *names*, not a frozen tool list, so a plugin installed later
 * can satisfy `plugin:<name>` or an explicit `<plugin>__<tool>` without rewriting the roster.
 * `resolveAgentCapabilities()` turns those names into the exact tools and extensions a
 * conversation is configured with, using the registry snapshot that is live at that moment.
 *
 * The tool lists below are views of `src/tools/inventory.ts`, where each tool declares itself
 * once; nothing here spells a tool name out.
 */
import { declaredTools, type ToolCapabilityGroup } from "../tools/inventory";

/**
 * The tools that read whichever data source is connected. `load_dataset` is local intake, so it
 * belongs to the analyst group: a `databricks` specialist cannot swap its source for a CSV.
 */
export const DATA_TOOLS = declaredTools("databricks");

/** Tools that come from the core analyst extension (`durable-analyst`). */
export const ANALYST_TOOLS = [...DATA_TOOLS, ...declaredTools("analyst")];

/**
 * Kept as the name existing profiles use: the data tools are the same for every source, so a
 * `databricks` agent gets them without also getting the document tools.
 */
export const DATABRICKS_TOOLS = DATA_TOOLS;

/** Tools that come from the `coding-tools` extension. */
export const CODING_TOOLS = declaredTools("coding");

/** Roster management and delegation. A run-mode specialist never gets these. */
export const ROSTER_TOOLS = declaredTools("roster");

/** The meta-agent's self-extension tools. A run-mode specialist never gets these. */
export const FEATURE_TOOLS = declaredTools("features");

export interface CapabilityGroup {
    description: string;
    tools: readonly string[];
}

/** Group ids that resolve to a fixed list; `all` and `plugins` resolve from the live inventory. */
type DeclaredGroupId = ToolCapabilityGroup | "all" | "plugins";

export const AGENT_CAPABILITY_GROUPS = {
    all: {
        description: "Every tool currently installed, including plugins and self-extension.",
        tools: [],
    },
    analyst: {
        description: "Profile local CSV/JSON, run read-only SQL, hypotheses, findings, playbook, audit.",
        tools: ANALYST_TOOLS,
    },
    databricks: {
        description: "The data-source tools: read-only SQL, discovery, profile and metrics for whichever source is connected.",
        tools: DATABRICKS_TOOLS,
    },
    coding: {
        description: "read, write, edit and bash inside the agent workspace.",
        tools: CODING_TOOLS,
    },
    plugins: {
        description: "Every installed data plugin tool (`<plugin>__<tool>`), loaded through tool_search.",
        tools: [],
    },
    roster: {
        description: "Create, update and archive specialists, and delegate work to them.",
        tools: ROSTER_TOOLS,
    },
    features: {
        description: "Create skills and plugins for DataClaw itself, then apply them at runtime.",
        tools: FEATURE_TOOLS,
    },
} as const satisfies Record<DeclaredGroupId, CapabilityGroup>;

export type AgentCapabilityGroup = keyof typeof AGENT_CAPABILITY_GROUPS;

export const AGENT_CAPABILITY_NAMES = Object.keys(AGENT_CAPABILITY_GROUPS) as AgentCapabilityGroup[];

/** Default for a specialist that only produces work. */
export const DEFAULT_SPECIALIST_CAPABILITIES: readonly string[] = [
    "analyst",
    "databricks",
    "coding",
    "plugins",
];

/** The coordinator starts with everything, including roster and self-extension. */
export const COORDINATOR_CAPABILITIES: readonly string[] = ["all"];

export interface ToolInventory {
    /** Tool name to the extension that provides it. First registration wins. */
    tools: ReadonlyMap<string, string>;
    /** Installed extension names, in registry order. */
    extensions: readonly string[];
}

export interface CapabilityResolution {
    /** Enabled tool names, in the order the capabilities were declared. */
    tools: string[];
    /** Extensions that should be selected for the conversation. */
    extensions: string[];
    /** Groups the agent asked for. */
    groups: string[];
    /** Plugin names implied by `plugins`, `plugin:<name>` or a `<plugin>__<tool>` capability. */
    plugins: string[];
    /** Explicit tool names that are not installed right now; they may exist after features_apply. */
    unknown: string[];
}

export interface ResolveCapabilitiesOptions {
    /** A spawned run cannot delegate or extend DataClaw: strip roster and feature tools. */
    isolate?: boolean;
}

export function isCapabilityGroup(value: string): value is AgentCapabilityGroup {
    return Object.prototype.hasOwnProperty.call(AGENT_CAPABILITY_GROUPS, value);
}

export function capabilityGroups(tools: readonly string[]): AgentCapabilityGroup[] {
    return AGENT_CAPABILITY_NAMES.filter((name) => tools.includes(name));
}

/** True when these capabilities let an agent manage the roster. */
export function capabilitiesCanManage(capabilities: readonly string[] | undefined): boolean {
    return (capabilities ?? []).some((capability) => capability === "all" || capability === "roster");
}

export function defaultCapabilitiesForRole(role: string): string[] {
    return role === "coordinator" ? [...COORDINATOR_CAPABILITIES] : [...DEFAULT_SPECIALIST_CAPABILITIES];
}

/** Human-readable one-liner for prompts and the console. */
export function formatCapabilities(capabilities: readonly string[] | undefined): string {
    const list = capabilities ?? [];
    return list.length === 0 ? "none" : list.join(", ");
}

/**
 * Turn capability names into the tool and extension selection for one conversation.
 *
 * - `all` takes every installed tool and extension.
 * - A group adds its tools (from the static list above, plus live plugin tools for `plugins`).
 * - `plugin:<name>` adds that plugin's extension and every tool it publishes.
 * - `tool:<name>` (or a bare tool name) enables that tool; unknown names are reported but kept,
 *   so an agent can name a plugin tool before `features_apply` installs the plugin.
 */
export function resolveAgentCapabilities(
    capabilities: readonly string[],
    inventory: ToolInventory,
    options: ResolveCapabilitiesOptions = {},
): CapabilityResolution {
    const selected = new Set<string>();
    const extensions = new Set<string>(["durable-analyst"]);
    const groups: string[] = [];
    const plugins = new Set<string>();
    const unknown: string[] = [];

    const addTool = (name: string): void => {
        selected.add(name);
        const extension = inventory.tools.get(name);
        if (!extension) return;
        extensions.add(extension);
        if (extension.startsWith("plugin:")) plugins.add(extension.slice("plugin:".length));
    };

    for (const raw of capabilities) {
        const capability = raw.trim();
        if (!capability) continue;

        if (capability === "all") {
            groups.push(capability);
            for (const name of inventory.tools.keys()) addTool(name);
            for (const extension of inventory.extensions) extensions.add(extension);
            continue;
        }

        if (isCapabilityGroup(capability)) {
            groups.push(capability);
            const group = AGENT_CAPABILITY_GROUPS[capability];
            if (capability === "plugins") {
                for (const [name, extension] of inventory.tools) {
                    if (extension.startsWith("plugin:")) addTool(name);
                }
            } else {
                for (const name of group.tools) addTool(name);
            }
            continue;
        }

        if (capability.startsWith("plugin:")) {
            const plugin = capability.slice("plugin:".length);
            groups.push(capability);
            plugins.add(plugin);
            extensions.add(`plugin:${plugin}`);
            for (const [name, extension] of inventory.tools) {
                if (extension === `plugin:${plugin}`) addTool(name);
            }
            continue;
        }

        const name = capability.startsWith("tool:") ? capability.slice("tool:".length) : capability;
        addTool(name);
        if (!inventory.tools.has(name)) unknown.push(name);
    }

    // Deferred plugin tools need the loader in the same conversation.
    if (plugins.size > 0 && inventory.tools.has("tool_search")) {
        extensions.add("tool-search");
        selected.add("tool_search");
    }

    if (options.isolate) {
        const managerOnly = new Set<string>([...ROSTER_TOOLS, ...FEATURE_TOOLS]);
        for (const name of [...selected]) {
            if (managerOnly.has(name)) selected.delete(name);
        }
    }

    return {
        tools: [...selected],
        // A plugin or tool-search extension that is not installed yet is simply not selectable now.
        extensions: [...extensions].filter((name) => inventory.extensions.includes(name) || name === "durable-analyst"),
        groups,
        plugins: [...plugins],
        unknown,
    };
}
