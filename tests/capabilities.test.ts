import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createAnalystHarness } from "../src/harness";
import {
    addPlugin,
    addSkill,
    capabilityCatalog,
    readDisabled,
    removePlugin,
    removeSkill,
    setCapabilityEnabled,
    writeDisabled,
} from "../src/capabilities/catalog";
import { createPluginAgentTools } from "../src/plugins";
import { ANALYST_TOOLS, CODING_TOOLS } from "../src/docs/agent-capabilities";
import { formatSkillsForPrompt, loadSkills } from "../src/workspace/context";

const FAKE_MCP = resolve(import.meta.dir, "fixtures/plugins/fake-stats-mcp");
const tmp = mkdtempSync(join(tmpdir(), "dataclaw-capabilities-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const project = () => {
    const root = join(tmp, `p${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(root, { recursive: true });
    return root;
};

describe("capability config", () => {
    test("reads a missing or malformed file as 'nothing disabled'", () => {
        const root = project();
        expect(readDisabled(root)).toEqual({ disabled: [], errors: [] });

        writeFileSync(join(root, "dataclaw.capabilities.json"), "{ not json");
        const read = readDisabled(root);
        expect(read.disabled).toEqual([]);
        expect(read.errors[0]).toContain("dataclaw.capabilities.json");
    });

    test("toggles are durable, sorted and de-duplicated", () => {
        const root = project();
        writeDisabled(root, ["plugin:b", "plugin:a", "plugin:a"]);
        expect(JSON.parse(readFileSync(join(root, "dataclaw.capabilities.json"), "utf8"))).toEqual({ disabled: ["plugin:a", "plugin:b"] });

        setCapabilityEnabled(root, "plugin:a", true);
        expect(readDisabled(root).disabled).toEqual(["plugin:b"]);
        setCapabilityEnabled(root, "skill:data-exploration", false);
        expect(readDisabled(root).disabled).toEqual(["plugin:b", "skill:data-exploration"]);
    });

    test("core capabilities and MCP connections refuse to toggle", () => {
        const root = project();
        expect(() => setCapabilityEnabled(root, "tool:analyst", false)).toThrow(/core/);
        expect(() => setCapabilityEnabled(root, "tool:tool-search", false)).toThrow(/core/);
        expect(() => setCapabilityEnabled(root, "mcp:databricks", false)).toThrow(/configured/);
        expect(() => setCapabilityEnabled(root, "nonsense", false)).toThrow(/invalid capability id/);
    });
});

describe("plugins and skills from the console", () => {
    test("installs an MCP plugin with no capabilities, and only agent tools", async () => {
        const root = project();
        const added = addPlugin(root, {
            name: "plain-tools",
            version: "0.1.0",
            description: "tools only",
            domain: "stats",
            capabilities: [],
            transport: { type: "mcp", command: "true" },
        });
        expect(added.path.endsWith("plugins/plain-tools/plugin.json")).toBe(true);

        // A script plugin with no capability is unreachable, so it is rejected.
        expect(() => addPlugin(root, {
            name: "lonely-script",
            version: "0.1.0",
            description: "nothing calls it",
            domain: "stats",
            capabilities: [],
            transport: { type: "script", command: "true" },
        })).toThrow(/non-empty/);

        removePlugin(root, "plain-tools");
        expect(() => removePlugin(root, "plain-tools")).toThrow(/not installed/);
    });

    test("refuses to delete a plugin it did not install", () => {
        const root = project();
        expect(() => removePlugin(root, "teatools")).toThrow(/not installed in plugins\//);
    });

    test("adds and removes a workspace skill", async () => {
        const root = project();
        const workspaceDir = join(root, "workspace");
        const added = addSkill(workspaceDir, { name: "Readout", description: "Use when reporting an A/B test.", body: "1. Quote method." });
        expect(added.name).toBe("readout");
        expect(readFileSync(added.path, "utf8")).toContain("description: Use when reporting an A/B test.");

        const catalog = await capabilityCatalog({ projectRoot: root, workspaceDir });
        expect(catalog.entries.find((entry) => entry.id === "skill:readout")?.enabled).toBe(true);

        removeSkill(workspaceDir, "readout");
        expect((await capabilityCatalog({ projectRoot: root, workspaceDir })).entries.some((entry) => entry.id === "skill:readout")).toBe(false);
    });
});

describe("the catalog reports the declared inventory", () => {
    test("tool rows come from the declarations and a loaded plugin reports the names the model calls", async () => {
        const root = project();
        addPlugin(root, {
            name: "fake-stats-mcp",
            version: "0.0.1",
            description: "test server",
            domain: "stats",
            capabilities: [],
            transport: { type: "mcp", command: "bun", args: [join(FAKE_MCP, "server.ts")] },
        });

        const loaded = await createPluginAgentTools({ root });
        try {
            const catalog = await capabilityCatalog({
                projectRoot: root,
                workspaceDir: join(root, "workspace"),
                loaded,
                databricks: { connected: false },
            });

            // Nothing hand-written: the rows are the same lists the capability resolver installs.
            expect(catalog.entries.find((entry) => entry.id === "tool:analyst")?.details.tools).toEqual([...ANALYST_TOOLS]);
            expect(catalog.entries.find((entry) => entry.id === "tool:coding")?.details.tools).toEqual([...CODING_TOOLS]);

            const plugin = catalog.entries.find((entry) => entry.id === "plugin:fake-stats-mcp");
            expect(plugin?.details.tools).toEqual(loaded.toolNames);
            expect(plugin?.details.tools).toContain("fake-stats-mcp__compare_eval_runs");
        } finally {
            await loaded.close();
        }
    }, 60_000);
});

describe("the catalog and the harness agree on what is off", () => {
    test("a disabled plugin is skipped before it starts, and the catalog says so", async () => {
        const root = project();
        addPlugin(root, {
            name: "fake-stats-mcp",
            version: "0.0.1",
            description: "test server",
            domain: "stats",
            capabilities: [],
            transport: { type: "mcp", command: "bun", args: [join(FAKE_MCP, "server.ts")] },
        });

        const enabled = await createPluginAgentTools({ root });
        try {
            expect(enabled.toolNames).toContain("fake-stats-mcp__compare_eval_runs");
            expect(enabled.extensions.map((extension) => extension.name)).toEqual(["plugin:fake-stats-mcp"]);
        } finally {
            await enabled.close();
        }

        setCapabilityEnabled(root, "plugin:fake-stats-mcp", false);
        const off = await createPluginAgentTools({ root, disabled: readDisabled(root).disabled.map((id) => id.replace("plugin:", "")) });
        try {
            expect(off.toolNames).toEqual([]);
            expect(off.disabled).toEqual(["fake-stats-mcp"]);
        } finally {
            await off.close();
        }

        const catalog = await capabilityCatalog({ projectRoot: root, workspaceDir: join(root, "workspace"), databricks: { connected: false } });
        const entry = catalog.entries.find((item) => item.id === "plugin:fake-stats-mcp");
        expect(entry?.enabled).toBe(false);
        expect(entry?.details.transport).toBe("mcp");
        expect(off.errors).toEqual([]);
    }, 60_000);

    test("the harness skips a plugin switched off in dataclaw.capabilities.json", async () => {
        const root = project();
        addPlugin(root, {
            name: "fake-stats-mcp",
            version: "0.0.1",
            description: "test server",
            domain: "stats",
            capabilities: [],
            transport: { type: "mcp", command: "bun", args: [join(FAKE_MCP, "server.ts")] },
        });

        const run = async (workspaceName: string) => createAnalystHarness({
            storagePath: ":memory:",
            resume: false,
            databricks: false,
            fauxHandle: fauxProvider({ provider: "faux", models: [{ id: "probe" }] }),
            model: { provider: "faux", modelId: "probe" },
            projectRoot: root,
            workspaceDir: join(root, workspaceName),
        });

        const on = await run("workspace-on");
        try {
            expect(on.pluginTools?.toolNames).toContain("fake-stats-mcp__compare_eval_runs");
            expect(on.registry.snapshot().installed().map((extension) => extension.name)).toContain("plugin:fake-stats-mcp");
        } finally {
            await on.close();
        }

        setCapabilityEnabled(root, "plugin:fake-stats-mcp", false);
        const off = await run("workspace-off");
        try {
            expect(off.pluginTools?.toolNames).toEqual([]);
            const installed = off.registry.snapshot().installed().map((extension) => extension.name);
            expect(installed).not.toContain("plugin:fake-stats-mcp");
            expect(installed).not.toContain("tool-search");
        } finally {
            await off.close();
        }
    }, 60_000);

    test("a disabled skill leaves the prompt but stays on disk", async () => {
        const root = project();
        const workspaceDir = join(root, "workspace");
        addSkill(workspaceDir, { name: "kept", description: "Kept for later." });
        setCapabilityEnabled(root, "skill:kept", false);

        const all = await loadSkills({ workspaceDir, projectRoot: root });
        const enabledSkills = await loadSkills({ workspaceDir, projectRoot: root, disabledSkills: readDisabled(root).disabled.map((id) => id.replace("skill:", "")) });
        expect(all.map((skill) => skill.name)).toContain("kept");
        expect(enabledSkills.map((skill) => skill.name)).not.toContain("kept");
        // Personal skills on the machine may still fill the catalog; the disabled one must not appear.
        expect(formatSkillsForPrompt(enabledSkills) ?? "").not.toContain("<name>kept</name>");
        expect(formatSkillsForPrompt(all)).toContain("<name>kept</name>");

        const catalog = await capabilityCatalog({ projectRoot: root, workspaceDir, databricks: { connected: false } });
        expect(catalog.entries.find((entry) => entry.id === "skill:kept")?.enabled).toBe(false);
        expect(readFileSync(join(workspaceDir, "skills", "kept", "SKILL.md"), "utf8")).toContain("Kept for later.");
    });
});
