import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { createAnalystHarness } from "../src/harness";
import {
    capabilitiesCanManage,
    resolveAgentCapabilities,
    type ToolInventory,
} from "../src/docs/agent-capabilities";
import {
    AgentRosterDoc,
    applyAgentUpdate,
    prepareAgent,
    type AgentRosterDocument,
} from "../src/docs/agents";

function inventory(): ToolInventory {
    return {
        tools: new Map([
            ["query_data", "durable-analyst"],
            ["discover_data", "durable-analyst"],
            ["agents_create", "durable-analyst"],
            ["features_apply", "durable-analyst"],
            ["read", "coding-tools"],
            ["write", "coding-tools"],
            ["tool_search", "tool-search"],
            ["demo__echo", "plugin:demo"],
        ]),
        extensions: ["durable-analyst", "coding-tools", "tool-search", "plugin:demo"],
    };
}

function emptyRoster(): AgentRosterDocument {
    return { agents: [], runs: [] };
}

describe("agent capability resolution", () => {
    test("groups, plugin tools, explicit tools, and isolation", () => {
        const all = resolveAgentCapabilities(["all"], inventory());
        expect(all.tools).toContain("demo__echo");
        expect(all.extensions).toContain("plugin:demo");
        expect(all.extensions).toContain("tool-search");

        const narrow = resolveAgentCapabilities(["analyst", "coding"], inventory());
        expect(narrow.tools).toContain("query_data");
        expect(narrow.tools).toContain("read");
        expect(narrow.tools).not.toContain("spawn_agent");
        expect(narrow.extensions).toEqual(["durable-analyst", "coding-tools"]);

        const plugin = resolveAgentCapabilities(["plugins"], inventory());
        expect(plugin.tools).toContain("demo__echo");
        expect(plugin.tools).toContain("tool_search");
        expect(plugin.plugins).toEqual(["demo"]);
        expect(plugin.extensions).toContain("plugin:demo");

        const explicit = resolveAgentCapabilities(["plugin:demo", "tool:read"], inventory());
        expect(explicit.tools).toContain("demo__echo");
        expect(explicit.tools).toContain("read");
        expect(explicit.extensions).toContain("coding-tools");

        const isolated = resolveAgentCapabilities(["all"], inventory(), { isolate: true });
        expect(isolated.tools).not.toContain("agents_create");
        expect(isolated.tools).not.toContain("features_apply");
        expect(isolated.tools).toContain("demo__echo");
    });

    test("an unknown explicit tool is kept for a later plugin reload", () => {
        const resolution = resolveAgentCapabilities(["future__forecast"], inventory());
        expect(resolution.tools).toContain("future__forecast");
        expect(resolution.unknown).toEqual(["future__forecast"]);
        expect(resolution.extensions).toEqual(["durable-analyst"]);
    });

    test("roster capability is what makes an agent a manager", () => {
        expect(capabilitiesCanManage(["all"])).toBe(true);
        expect(capabilitiesCanManage(["roster"])).toBe(true);
        expect(capabilitiesCanManage(["analyst", "plugin:demo"])).toBe(false);
    });
});

describe("agent profiles", () => {
    test("prepareAgent stores persona, knowledge, skills, model, and resolved management", () => {
        const custom = prepareAgent(emptyRoster(), {
            name: "Churn Bot",
            role: "custom",
            instructions: "You are a churn specialist. Explain every number with the query that produced it.",
            capabilities: ["analyst", "coding"],
            contextFiles: ["brief.md"],
            background: "The March cohort is the one to watch.",
            skills: ["data-exploration"],
            model: "opencode-go/deepseek-v4.1-flash",
        }, 1);
        expect(custom.ok).toBe(true);
        if (!custom.ok) return;
        expect(custom.agent.capabilities).toEqual(["analyst", "coding"]);
        expect(custom.agent.canManage).toBe(false);
        expect(custom.agent.contextFiles).toEqual(["brief.md"]);
        expect(custom.agent.skills).toEqual(["data-exploration"]);
        expect(custom.agent.model).toEqual({ provider: "opencode-go", modelId: "deepseek-v4.1-flash" });
        expect(custom.agent.compute).toEqual({ kind: "local" });

        const coordinator = prepareAgent(emptyRoster(), {
            name: "Team Lead",
            role: "custom",
            instructions: "You coordinate the other specialists and delegate the work.",
            capabilities: ["all", "roster"],
        }, 2);
        expect(coordinator.ok).toBe(true);
        if (coordinator.ok) expect(coordinator.agent.canManage).toBe(true);

        const defaulted = prepareAgent(emptyRoster(), { name: "Researcher", role: "researcher" }, 3);
        expect(defaulted.ok).toBe(true);
        if (defaulted.ok) {
            expect(defaulted.agent.capabilities).toEqual(["analyst", "databricks", "coding", "plugins"]);
            expect(defaulted.agent.contextFiles).toEqual([]);
        }
    });

    test("refuses paths and capability lists that could escape the workspace", () => {
        const base = {
            name: "Scout",
            role: "custom" as const,
            instructions: "You are a scout and you return a short brief.",
        };
        expect(prepareAgent(emptyRoster(), { ...base, contextFiles: ["../secrets.md"] }, 1).ok).toBe(false);
        expect(prepareAgent(emptyRoster(), { ...base, contextFiles: ["/etc/passwd"] }, 2).ok).toBe(false);
        expect(prepareAgent(emptyRoster(), { ...base, contextFiles: ["report.pdf"] }, 3).ok).toBe(false);
        expect(prepareAgent(emptyRoster(), { ...base, capabilities: [] }, 4).ok).toBe(false);
        expect(prepareAgent(emptyRoster(), { ...base, model: "not-a-model" }, 5).ok).toBe(false);
    });

    test("a version 1 roster gains profile defaults on migration", () => {
        const migrate = AgentRosterDoc.definition.migrate as ((value: Record<string, unknown>, from: number) => AgentRosterDocument) | undefined;
        expect(migrate).toBeDefined();
        const migrated = migrate!({ agents: [{
            id: "legacy",
            name: "Legacy",
            role: "coordinator",
            purpose: "Old roster entry",
            instructions: "You coordinate.",
            status: "active",
            canManage: true,
            conversationId: 4,
            createdByTask: "",
            createdAt: 1,
            updatedAt: 1,
        }], runs: [] }, 1);
        expect(migrated.agents[0]?.capabilities).toEqual(["all"]);
        expect(migrated.agents[0]?.contextFiles).toEqual([]);
        expect(migrated.agents[0]?.skills).toEqual([]);
        expect(migrated.agents[0]?.background).toBe("");
        expect(migrated.agents[0]?.compute).toEqual({ kind: "shared" });
    });

    test("updating capabilities re-derives canManage", () => {
        const roster = emptyRoster();
        const created = prepareAgent(roster, {
            name: "Lead",
            role: "custom",
            instructions: "You coordinate specialists and return their findings.",
            capabilities: ["all"],
        }, 1);
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        roster.agents.push(created.agent);
        expect(created.agent.canManage).toBe(true);

        const narrowed = applyAgentUpdate(roster, "lead", { capabilities: ["analyst"] }, 2);
        expect(narrowed.ok).toBe(true);
        if (narrowed.ok) expect(narrowed.agent.canManage).toBe(false);
    });
});

describe("a specialist runs with its own context and capabilities", () => {
    test("creates a custom agent, configures only its tools, and renders its knowledge", async () => {
        const faux = fauxProvider({
            provider: "faux",
            models: [{ id: "test-model", name: "Test model" }],
        });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("agents_create", {
                name: "Churn Bot",
                role: "custom",
                instructions: "You are a churn specialist. Cite the query behind every number.",
                capabilities: ["analyst", "coding"],
                contextFiles: ["brief.md"],
                background: "The March cohort is the one to watch.",
                skills: ["data-exploration"],
            } as never), { stopReason: "toolUse" }),
            fauxAssistantMessage("Created the churn bot."),
        ]);

        const projectRoot = await mkdtemp(join(tmpdir(), "dataclaw-profile-"));
        await mkdir(join(projectRoot, "workspace"), { recursive: true });
        await writeFile(join(projectRoot, "workspace", "brief.md"), "# Brief\n\nMarch churn spike.\n");
        const analyst = await createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            pluginTools: false,
            fauxHandle: faux,
            model: { provider: "faux", modelId: "test-model" },
            projectRoot,
            workspaceDir: join(projectRoot, "workspace"),
        });

        try {
            await analyst.conversation.submit(
                { type: "input", content: "Create a churn bot with the brief.", requestId: "profile" },
                analyst.context,
            );
            await analyst.conversation.waitForIdle(analyst.context);

            const agent = (await analyst.getRoster())?.agents.find((item) => item.id === "churn-bot");
            expect(agent?.capabilities).toEqual(["analyst", "coding"]);
            expect(agent?.contextFiles).toEqual(["brief.md"]);

            const session = await analyst.harness.conversation(agent!.conversationId as never, analyst.context);
            const configured = await session!.agent(analyst.context);
            const toolNames = configured.tools.map((tool: ToolRegistration) => tool.name);
            expect(toolNames).toContain("query_data");
            expect(toolNames).toContain("read");
            expect(toolNames).not.toContain("spawn_agent");
            expect(configured.extensions.map((extension) => extension.name)).toEqual([
                "durable-analyst",
                "coding-tools",
            ]);
            expect(configured.sections.map((section) => section.key)).toContain("agent_profile");
            expect(configured.cwd).toBe(join(projectRoot, "workspace", "agents", "churn-bot"));
            expect(existsSync(join(projectRoot, "workspace", "agents", "churn-bot", "README.md"))).toBe(true);

            const profileSection = configured.sections.find((section) => section.key === "agent_profile");
            expect(profileSection).toBeDefined();
            const rendered = await profileSection!.render({
                conversationId: agent!.conversationId as never,
                agent: configured,
                env: undefined,
                shown: {},
                read: analyst.harness,
            }, analyst.context);
            expect(rendered).toContain("You are Churn Bot");
            expect(rendered).toContain("March cohort is the one to watch");
            expect(rendered).toContain("Knowledge: brief.md");
            expect(rendered).toContain("March churn spike");
        } finally {
            await analyst.close();
            await rm(projectRoot, { recursive: true, force: true });
        }
    }, 30_000);
});
