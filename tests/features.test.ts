import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { createAnalystHarness } from "../src/harness";
import {
    featuresCreatePluginTool,
    featuresCreateSkillTool,
    featuresListTool,
    featuresRemovePluginTool,
} from "../src/tools/feature-tools";
import { loadSkills } from "../src/workspace/context";

const FAKE_MCP_SERVER = resolve(import.meta.dir, "fixtures/plugins/fake-stats-mcp/server.ts");
const tmp = mkdtempSync(join(tmpdir(), "dataclaw-features-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const toolText = (result: { content: { type: string; text?: string }[] }): string =>
    result.content.map((item) => item.text ?? "").join("\n");

describe("self-extension tools", () => {
    test("creates a workspace skill that the next turn can see", async () => {
        const projectRoot = join(tmp, "skill-project");
        const workspaceDir = join(projectRoot, "workspace");
        const faux = fauxProvider({ provider: "faux", models: [{ id: "probe" }] });
        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            pluginTools: false,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "probe" },
            projectRoot,
            workspaceDir,
        });
        try {
            const result = await featuresCreateSkillTool.execute({
                name: "churn-readout",
                description: "Use when reporting a churn investigation.",
                body: "# Churn readout\n\n1. Quote the query.\n2. Show the denominator.",
            }, {} as never, {} as never);
            expect(toolText(result)).toContain("churn-readout");
            const skills = await loadSkills({ workspaceDir, projectRoot });
            expect(skills.find((skill) => skill.name === "churn-readout")?.description)
                .toContain("churn investigation");
        } finally {
            await analyst.close();
        }
    });

    test("creates a plugin, applies it, and reconfigures an existing agent", async () => {
        const projectRoot = join(tmp, "plugin-project");
        const workspaceDir = join(projectRoot, "workspace");
        const faux = fauxProvider({ provider: "faux", models: [{ id: "probe" }] });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("agents_create", {
                name: "Self Stats",
                role: "custom",
                instructions: "You are a statistics specialist. Use the selfstats plugin and cite its method.",
                capabilities: ["analyst", "plugin:selfstats"],
            } as never), { stopReason: "toolUse" }),
            fauxAssistantMessage("Created the statistician before the plugin existed."),
        ]);

        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            pluginTools: true,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "probe" },
            projectRoot,
            workspaceDir,
        });

        try {
            await analyst.conversation.submit(
                { type: "input", content: "Create a statistics specialist.", requestId: "create-specialist" },
                analyst.context,
            );
            await analyst.conversation.waitForIdle(analyst.context);
            const agent = (await analyst.getRoster())?.agents.find((item) => item.id === "self-stats");
            expect(agent?.capabilities).toEqual(["analyst", "plugin:selfstats"]);

            const created = await featuresCreatePluginTool.execute({
                name: "selfstats",
                description: "Self-authored stats tools for testing",
                domain: "stats",
                capabilities: [],
                transport: { type: "mcp", command: "bun", args: ["server.ts"] },
                files: [{ path: "server.ts", content: readFileSync(FAKE_MCP_SERVER, "utf8") }],
            }, {} as never, {} as never);
            expect(toolText(created)).toContain("selfstats");

            const listing = await featuresListTool.execute({}, {} as never, {} as never);
            expect(toolText(listing)).toContain("plugin:selfstats");

            const reload = await analyst.reloadFeatures();
            expect(reload.errors).toEqual([]);
            expect(reload.toolNames).toContain("selfstats__compare_eval_runs");
            expect(reload.agentsUpdated).toContain("self-stats");
            expect(analyst.registry.snapshot().installed().map((extension) => extension.name))
                .toContain("plugin:selfstats");

            const session = await analyst.harness.conversation(agent!.conversationId as never, analyst.context);
            const configured = await session!.agent(analyst.context);
            const toolNames = configured.tools.map((tool: ToolRegistration) => tool.name);
            expect(toolNames).toContain("tool_search");
            // Plugin tools are deferred: enabled, but offered only after tool_search loads them.
            expect(configured.deferred.map((tool) => tool.name)).toContain("selfstats__compare_eval_runs");
            expect(configured.extensions.map((extension) => extension.name))
                .toContain("plugin:selfstats");

            const root = await analyst.conversation.agent(analyst.context);
            expect(root.deferred.map((tool) => tool.name)).toContain("selfstats__compare_eval_runs");

            const removed = await featuresRemovePluginTool.execute({ name: "selfstats" }, {} as never, {} as never);
            expect(toolText(removed)).toContain("selfstats");
            const afterRemoval = await analyst.reloadFeatures();
            expect(afterRemoval.toolNames).toEqual([]);
            expect(analyst.registry.snapshot().installed().map((extension) => extension.name))
                .not.toContain("plugin:selfstats");
        } finally {
            await analyst.close();
        }
    }, 60_000);

    test("the model can install a plugin through the feature tools", async () => {
        const projectRoot = join(tmp, "model-plugin-project");
        const workspaceDir = join(projectRoot, "workspace");
        const faux = fauxProvider({ provider: "faux", models: [{ id: "probe" }] });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("features_create_plugin", {
                name: "modelstats",
                description: "A plugin the model wrote",
                domain: "stats",
                capabilities: [],
                transport: { type: "mcp", command: "bun", args: ["server.ts"] },
                files: [{ path: "server.ts", content: readFileSync(FAKE_MCP_SERVER, "utf8") }],
            } as never), { stopReason: "toolUse" }),
            fauxAssistantMessage(fauxToolCall("features_apply", {} as never), { stopReason: "toolUse" }),
            fauxAssistantMessage("The plugin is live."),
        ]);

        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            pluginTools: true,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "probe" },
            projectRoot,
            workspaceDir,
        });
        try {
            await analyst.conversation.submit(
                { type: "input", content: "Add a stats plugin to yourself.", requestId: "self-extend" },
                analyst.context,
            );
            await analyst.conversation.waitForIdle(analyst.context);

            expect(readFileSync(join(projectRoot, "plugins", "modelstats", "server.ts"), "utf8")).toContain("fake-stats");
            expect(analyst.pluginTools?.toolNames).toContain("modelstats__compare_eval_runs");
            expect(analyst.registry.snapshot().installed().map((extension) => extension.name))
                .toContain("plugin:modelstats");
        } finally {
            await analyst.close();
        }
    }, 60_000);
});
