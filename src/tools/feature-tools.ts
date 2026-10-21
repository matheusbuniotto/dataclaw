/**
 * Self-extension tools: DataClaw can add capabilities to itself from chat.
 *
 * - A **skill** is markdown instructions in `workspace/skills/<name>/SKILL.md`, read on demand.
 *   It is visible on the next turn without a reload.
 * - A **plugin** is an MCP server plus a manifest under `plugins/<name>/`. `features_apply`
 *   starts it, installs its tools as `<plugin>__<tool>`, and reconfigures roster agents.
 *
 * Both paths use the same validation as the console (`src/capabilities/catalog.ts`), and a
 * plugin that will not start is reported instead of taking the agent down.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import {
    AGENT_CAPABILITY_GROUPS,
    AGENT_CAPABILITY_NAMES,
    formatCapabilities,
} from "../docs/agent-capabilities";
import {
    addPlugin,
    addSkill,
    removePlugin,
    removeSkill,
} from "../capabilities/catalog";
import { discoverPlugins } from "../plugins/manifest";
import { loadSkills, currentWorkspace } from "../workspace/context";
import { currentFeatureRuntime } from "../features/runtime";

function textResult(text: string, isError = false) {
    return {
        content: [{ type: "text" as const, text }],
        ...(isError ? { isError: true } : {}),
    };
}

function failure(err: unknown): ReturnType<typeof textResult> {
    return textResult(err instanceof Error ? err.message : String(err), true);
}

export const featuresListTool = defineTool({
    name: "features_list",
    description:
        "Lists DataClaw's capabilities and the tools that implement them: built-in groups, installed plugins, workspace skills, and any plugin errors. Use this before creating a skill or plugin, and before giving an agent capabilities.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
        try {
            const workspace = currentWorkspace();
            const runtime = currentFeatureRuntime();
            const plugins = discoverPlugins({ root: workspace.projectRoot });
            const skills = await loadSkills(workspace);
            const pluginErrors = runtime?.pluginErrors() ?? [];
            const lines: string[] = ["## DataClaw features", ""];

            lines.push("### Tool groups");
            for (const name of AGENT_CAPABILITY_NAMES) {
                const group = AGENT_CAPABILITY_GROUPS[name];
                const tools = name === "all"
                    ? "every installed tool"
                    : name === "plugins"
                        ? "every plugin tool (`tool_search` loads them)"
                        : group.tools.join(", ");
                lines.push(`- ${name}: ${group.description}\n  tools: ${tools}`);
            }

            lines.push("", "### Installed plugins");
            if (plugins.length === 0) {
                lines.push("- none. Create one with features_create_plugin, then features_apply.");
            } else {
                for (const plugin of plugins) {
                    const manifest = plugin.manifest;
                    const prefix = `${manifest.name}__`.replace(/[^a-zA-Z0-9_-]/g, "_");
                    const connected = runtime?.pluginToolNames().filter((name) => name.startsWith(prefix)) ?? [];
                    lines.push(`- plugin:${manifest.name} ${manifest.version} [${manifest.domain}] — ${manifest.description}`);
                    lines.push(`  capabilities: ${manifest.capabilities.length ? manifest.capabilities.join(", ") : "(tools only)"}`);
                    lines.push(`  agent tools: ${connected.length ? connected.join(", ") : "(not connected; run features_apply)"}`);
                }
            }

            lines.push("", "### Workspace skills");
            if (skills.length === 0) {
                lines.push("- none. Create one with features_create_skill.");
            } else {
                for (const skill of skills) {
                    lines.push(`- ${skill.name} (${skill.source}): ${skill.description}`);
                }
            }

            lines.push("", "### Agent capabilities");
            lines.push(`Use any of: ${AGENT_CAPABILITY_NAMES.join(", ")}, plugin:<name>, or an explicit tool name.`);
            lines.push(`Default specialist set: ${formatCapabilities(["analyst", "databricks", "coding", "plugins"])}.`);

            if (pluginErrors.length > 0) {
                lines.push("", "### Plugin errors", ...pluginErrors.map((error) => `- ${error}`));
            }
            return textResult(lines.join("\n"));
        } catch (err) {
            return failure(err);
        }
    },
});

export const featuresCreateSkillTool = defineTool({
    name: "features_create_skill",
    description:
        "Creates or replaces a workspace skill at workspace/skills/<name>/SKILL.md. Skills are instructions the agent reads on demand; they appear on the next turn without a reload. Prefer a skill for a procedure, checklist, house style, or domain knowledge. Use features_create_plugin when the capability must execute code.",
    parameters: Type.Object({
        name: Type.String({ description: "Lowercase id, such as churn-readout" }),
        description: Type.String({ description: "One line: when the agent should read this skill" }),
        body: Type.String({ description: "The SKILL.md body (markdown)" }),
    }),
    replay: "unsafe",
    execute: async (args) => {
        try {
            const workspace = currentWorkspace();
            const added = addSkill(workspace.workspaceDir, {
                name: args.name,
                description: args.description,
                body: args.body,
            });
            return textResult([
                `Created skill "${added.name}" at ${added.path}.`,
                "It is available on the next turn; no reload is needed. Add it to an agent profile with agents_update skills.",
            ].join("\n"));
        } catch (err) {
            return failure(err);
        }
    },
});

export const featuresRemoveSkillTool = defineTool({
    name: "features_remove_skill",
    description: "Removes a skill that DataClaw installed in the workspace's skills/ directory.",
    parameters: Type.Object({
        name: Type.String({ description: "Skill name from features_list" }),
    }),
    replay: "unsafe",
    execute: async (args) => {
        try {
            const workspace = currentWorkspace();
            removeSkill(workspace.workspaceDir, args.name);
            return textResult(`Removed skill "${args.name}". It leaves the prompt on the next turn.`);
        } catch (err) {
            return failure(err);
        }
    },
});

export const featuresCreatePluginTool = defineTool({
    name: "features_create_plugin",
    description:
        "Creates or replaces a data plugin under plugins/<name>/: writes optional source files and a plugin.json manifest, without starting it. The plugin is an MCP server over stdio or a script. Run features_apply afterwards to connect it and publish its tools as <plugin>__<tool>. Use this when DataClaw needs a new executable capability.",
    parameters: Type.Object({
        name: Type.String({ description: "Lowercase plugin id, such as forecaster" }),
        description: Type.String({ description: "One line for features_list" }),
        domain: Type.String({ description: "Area such as stats, ml, forecasting, fpa" }),
        version: Type.Optional(Type.String({ description: "Plugin version; default 0.1.0" })),
        capabilities: Type.Optional(Type.Array(Type.String(), { description: "Capability ids (domain.name@major). May be empty for an MCP tool-only plugin." })),
        priority: Type.Optional(Type.Number({ description: "Higher wins when plugins overlap; default 0" })),
        transport: Type.Object({
            type: Type.String({ description: "mcp or script" }),
            command: Type.String({ description: "Program to start, such as bun" }),
            args: Type.Optional(Type.Array(Type.String())),
            env: Type.Optional(Type.Record(Type.String(), Type.String())),
            cwd: Type.Optional(Type.String({ description: "Working directory relative to the manifest; default the plugin directory" })),
            tools: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Capability id to MCP tool name" })),
        }),
        files: Type.Optional(Type.Array(Type.Object({
            path: Type.String({ description: "Path relative to plugins/<name>/, such as server.ts" }),
            content: Type.String({ description: "File content" }),
        }), { description: "Source files to write before the manifest. plugin.json is reserved." })),
        replace: Type.Optional(Type.Boolean({ description: "Replace an existing plugins/<name>/plugin.json" })),
    }),
    replay: "unsafe",
    execute: async (args) => {
        try {
            const workspace = currentWorkspace();
            if (!/^[a-z0-9][a-z0-9_.-]*$/.test(args.name)) {
                return textResult(`Invalid plugin name "${args.name}": use lowercase letters, digits, dots, dashes or underscores.`, true);
            }
            const pluginDir = resolve(workspace.projectRoot, "plugins", args.name);
            if (existsSync(resolve(pluginDir, "plugin.json")) && args.replace !== true) {
                return textResult(`Plugin "${args.name}" already exists. Pass replace: true to overwrite it.`, true);
            }

            for (const file of args.files ?? []) {
                const target = safePluginPath(pluginDir, file.path);
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(target, file.content);
            }

            const transport: Record<string, unknown> = {
                type: args.transport.type,
                command: args.transport.command,
                ...(args.transport.args ? { args: args.transport.args } : {}),
                ...(args.transport.env ? { env: args.transport.env } : {}),
                ...(args.transport.cwd ? { cwd: args.transport.cwd } : {}),
                ...(args.transport.tools ? { tools: args.transport.tools } : {}),
            };
            const manifest = {
                name: args.name,
                version: args.version ?? "0.1.0",
                description: args.description,
                domain: args.domain,
                capabilities: args.capabilities ?? [],
                ...(args.priority === undefined ? {} : { priority: args.priority }),
                transport,
            };

            const added = addPlugin(workspace.projectRoot, manifest);
            return textResult([
                `Wrote ${added.path}.`,
                args.files?.length ? `Source files: ${args.files.map((file) => file.path).join(", ")}.` : "No source files were written.",
                "Run features_apply to start the plugin. Its tools become <plugin>__<tool>, and agents with the plugins capability can use them.",
            ].join("\n"));
        } catch (err) {
            return failure(err);
        }
    },
});

export const featuresRemovePluginTool = defineTool({
    name: "features_remove_plugin",
    description: "Removes a plugin DataClaw installed under the project's plugins/ directory. Run features_apply to uninstall its tools and extensions.",
    parameters: Type.Object({
        name: Type.String({ description: "Plugin name from features_list" }),
    }),
    replay: "unsafe",
    execute: async (args) => {
        try {
            const workspace = currentWorkspace();
            removePlugin(workspace.projectRoot, args.name);
            return textResult(`Removed plugin "${args.name}". Run features_apply to uninstall its tools.`);
        } catch (err) {
            return failure(err);
        }
    },
});

export const featuresApplyTool = defineTool({
    name: "features_apply",
    description:
        "Reloads installed plugins into the running agent: connects new MCP servers, publishes their tools, removes plugins that are gone, and reconfigures roster agents against the new capabilities. Run this after features_create_plugin or features_remove_plugin. Skills do not need it.",
    parameters: Type.Object({}),
    replay: "unsafe",
    execute: async () => {
        const runtime = currentFeatureRuntime();
        if (!runtime) {
            return textResult("No live feature runtime is attached. Open the console or the CLI harness and try again.", true);
        }
        try {
            const result = await runtime.reload();
            const lines = [
                `Reloaded ${result.plugins.length} plugin(s); ${result.toolNames.length} plugin tool(s) installed.`,
            ];
            for (const plugin of result.plugins) {
                lines.push(`- ${plugin.name} ${plugin.version}: ${plugin.tools.length ? plugin.tools.join(", ") : "no tools"}`);
            }
            if (result.errors.length > 0) {
                lines.push("Errors:", ...result.errors.map((error) => `- ${error}`));
            }
            lines.push(result.agentsUpdated.length > 0
                ? `Reconfigured agents: ${result.agentsUpdated.join(", ")}.`
                : "No roster agents needed reconfiguration.");
            return textResult(lines.join("\n"));
        } catch (err) {
            return failure(err);
        }
    },
});

function safePluginPath(pluginDir: string, path: string): string {
    const cleaned = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!cleaned || cleaned.startsWith("/") || cleaned.split("/").includes("..")) {
        throw new Error(`plugin file "${path}" must be relative and stay inside plugins/${pluginDir.split(sep).pop()}`);
    }
    if (cleaned === "plugin.json") {
        throw new Error("plugin.json is written from the manifest arguments; do not pass it in files");
    }
    const target = resolve(pluginDir, cleaned);
    if (!target.startsWith(`${resolve(pluginDir)}${sep}`)) {
        throw new Error(`plugin file "${path}" escapes the plugin directory`);
    }
    return target;
}
