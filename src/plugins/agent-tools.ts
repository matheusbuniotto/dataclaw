/**
 * Agent tools from data plugins.
 *
 * A plugin's capabilities serve the eval pipeline (see `registry.ts`). This module gives the
 * analyst agent the plugin's *whole* tool surface instead: one durable harness tool per MCP
 * tool the server publishes, named `<plugin>__<tool>`, with the JSON Schema the server
 * sent — so a plugin can add a tool without a DataClaw change.
 *
 * Why `replay: "unsafe"`: a plugin call is not a pure function of its arguments. `design`
 * writes a pre-registration plan to disk, `report` reads plans back. If a crash interrupts
 * a call, rerunning it on recovery could write the plan twice, so the harness abandons the
 * call and the model decides what to do instead.
 *
 * Tools are `deferred` by default: ten stats tools should not sit in every request. The
 * `data_plugins` section tells the model they exist and that `tool_search` loads them.
 * See docs/plugins.md.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section, type Extension, type ToolRegistration } from "@earendil-works/pi-durable";
import { discoverPlugins, type DiscoverOptions } from "./manifest";
import { openMcpPlugin, type McpToolClient } from "./transports";
import type { LoadedPlugin } from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;
/** Longest tool name most providers accept. */
const MAX_TOOL_NAME = 64;

export interface PluginAgentToolsOptions extends DiscoverOptions {
    /** Per-request timeout for the plugin's MCP server. Default 60s. */
    timeoutMs?: number;
    /** Add tools as deferred, so the model loads them through `tool_search`. Default true. */
    deferred?: boolean;
    /** Only these plugins (by name). Default: every installed plugin. */
    only?: readonly string[];
    /** Plugins switched off in `dataclaw.capabilities.json`; they never start. */
    disabled?: readonly string[];
    /** Called with each plugin problem; a broken plugin never keeps the agent from starting. */
    onError?: (message: string) => void;
}

export interface PluginAgentToolsSummary {
    name: string;
    version: string;
    domain: string;
    description: string;
    /** Harness tool names, in the order the server listed them. */
    tools: string[];
    /** The same tools under the names the plugin's server uses. */
    mcpTools: string[];
}

export interface PluginAgentTools {
    /**
     * One extension per plugin, named `plugin:<plugin>`, so the console can enable or disable
     * a single plugin (and a conversation can select it) without touching the others.
     */
    extensions: Extension<ToolRegistration>[];
    plugins: PluginAgentToolsSummary[];
    errors: string[];
    /** Every harness tool name, flattened. */
    toolNames: string[];
    deferred: boolean;
    /** Plugin names that were switched off before anything started. */
    disabled: string[];
    close(): Promise<void>;
}

/** Providers accept `[a-zA-Z0-9_-]`; MCP tool names allow dots, so replace whatever else appears. */
function toolName(plugin: string, tool: string): string {
    return `${plugin}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MAX_TOOL_NAME);
}

function render(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/**
 * Discover installed plugins and build one harness tool per MCP tool. Connects to every
 * MCP plugin once, here, so the schemas are known before the first turn; the connection is
 * reused for calls until `close()`.
 */
export async function createPluginAgentTools(options: PluginAgentToolsOptions = {}): Promise<PluginAgentTools> {
    const deferred = options.deferred ?? true;
    const errors: string[] = [];
    const report = (message: string) => {
        errors.push(message);
        options.onError?.(message);
    };

    let installed: LoadedPlugin[];
    try {
        installed = discoverPlugins(options);
    } catch (err) {
        // A bad or duplicated manifest must not keep the analyst agent from starting.
        report(err instanceof Error ? err.message : String(err));
        installed = [];
    }

    const clients: McpToolClient[] = [];
    const extensions: Extension<ToolRegistration>[] = [];
    const plugins: PluginAgentToolsSummary[] = [];
    const disabled = [...(options.disabled ?? [])];

    for (const plugin of installed) {
        const manifest = plugin.manifest;
        if (options.only && !options.only.includes(manifest.name)) continue;
        if (disabled.includes(manifest.name)) continue;
        const client = openMcpPlugin(plugin, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
        if (!client) {
            // Script transports are one call per capability and publish no tool inventory.
            report(`plugin ${manifest.name}: script plugins provide capabilities only, so no agent tools`);
            continue;
        }
        let definitions;
        try {
            definitions = await client.listToolDefinitions();
        } catch (err) {
            await client.close();
            report(err instanceof Error ? err.message : String(err));
            continue;
        }
        if (definitions.length === 0) {
            await client.close();
            report(`plugin ${manifest.name}: its MCP server lists no tools`);
            continue;
        }

        clients.push(client);
        const names: string[] = [];
        const tools: ToolRegistration[] = [];
        for (const definition of definitions) {
            const name = toolName(manifest.name, definition.name);
            names.push(name);
            const provided = definition.description?.trim() || `${definition.name} from the ${manifest.name} plugin.`;
            tools.push(defineTool({
                name,
                description: `${provided}\n\nProvided by the DataClaw plugin "${manifest.name}" ${manifest.version} (${manifest.domain}) as MCP tool "${definition.name}". Report its "method" and "warnings" fields verbatim when you use a number from it.`,
                // MCP publishes JSON Schema; hand it to the harness as-is instead of restating it.
                parameters: Type.Unsafe(definition.inputSchema ?? { type: "object" }),
                replay: "unsafe",
                ...(deferred ? { deferred: true as const } : {}),
                execute: async (args: unknown) => {
                    try {
                        const value = await client.callTool(definition.name, (args ?? {}) as Record<string, unknown>);
                        return { output: [{ type: "text" as const, text: render(value) }] };
                    } catch (err) {
                        return {
                            output: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                            isError: true,
                        };
                    }
                },
            }));
        }
        plugins.push({
            name: manifest.name,
            version: manifest.version,
            domain: manifest.domain,
            description: manifest.description,
            tools: names,
            mcpTools: definitions.map((definition) => definition.name),
        });

        // One extension per plugin: the console toggles plugins one at a time, and a
        // conversation can select `plugin:<name>` exactly like any other extension.
        const hint = deferred
            ? "Call tool_search to load the ones you need; they stay available for the rest of this conversation."
            : "These tools are available now.";
        extensions.push(defineExtension({
            name: `plugin:${manifest.name}`,
            sections: [
                section(`plugin_${manifest.name.replace(/[^a-z0-9_]/g, "_")}`, () => [
                    `### Plugin: ${manifest.name} ${manifest.version} [${manifest.domain}]`,
                    manifest.description,
                    hint,
                    `Tools: ${manifest.name}__${definitions.map((definition) => definition.name).join(`, ${manifest.name}__`)}`,
                    "These tools compute specialised results and return `method` and `warnings` next to every number. Quote them; never restate a plugin number from memory.",
                ].join("\n")),
            ],
            tools,
        }));
    }

    return {
        extensions,
        plugins,
        errors,
        toolNames: plugins.flatMap((p) => p.tools),
        deferred,
        disabled,
        async close() {
            await Promise.all(clients.map((client) => client.close()));
            clients.length = 0;
        },
    };
}
