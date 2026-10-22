import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createAnalystHarness } from "../src/harness";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { PLUGIN_TIMEOUT_MS, createPluginAgentTools } from "../src/plugins";

const FAKE_MCP = resolve(import.meta.dir, "fixtures/plugins/fake-stats-mcp");
const KAPPA_SCRIPT = resolve(import.meta.dir, "../examples/plugins/kappa-script");
const tmp = mkdtempSync(join(tmpdir(), "dataclaw-agent-tools-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const tool = (tools: readonly unknown[] | undefined, name: string) =>
    (tools as ToolRegistration[] | undefined)?.find((t) => t.name === name);

/** Every tool of every plugin extension, the way the registry sees them. */
const allTools = (plugins: Awaited<ReturnType<typeof createPluginAgentTools>>): ToolRegistration[] =>
    plugins.extensions.flatMap((extension) => [...(extension.tools ?? [])]);

describe("data plugin agent tools", () => {
    test("one harness tool per MCP tool, namespaced by plugin", async () => {
        const plugins = await createPluginAgentTools({ paths: [FAKE_MCP], root: tmp });
        try {
            expect(plugins.errors).toEqual([]);
            expect(plugins.toolNames).toEqual(["fake-stats-mcp__compare_eval_runs", "fake-stats-mcp__agreement_kappa"]);
            expect(plugins.plugins).toHaveLength(1);
            expect(plugins.plugins[0]?.domain).toBe("stats");
            expect(plugins.extensions.map((extension) => extension.name)).toEqual(["plugin:fake-stats-mcp"]);

            const compare = tool(allTools(plugins), "fake-stats-mcp__compare_eval_runs");
            expect(compare?.description).toContain("fake-stats-mcp");
            expect(compare?.deferred).toBe(true);
            // MCP publishes `{type: object}`, and that is what the harness validates against.
            expect(compare?.parameters).toMatchObject({ type: "object" });
        } finally {
            await plugins.close();
        }
    });

    test("a call returns the plugin's JSON and an error comes back as a tool error", async () => {
        const plugins = await createPluginAgentTools({ paths: [FAKE_MCP], root: tmp, deferred: false });
        try {
            expect(tool(allTools(plugins), "fake-stats-mcp__compare_eval_runs")?.deferred).toBeUndefined();

            const compare = tool(allTools(plugins), "fake-stats-mcp__compare_eval_runs")!;
            const ok = await compare.execute(
                { scores_a: [[1, 0]], scores_b: [[1, 1]], ci_method: "analytic" },
                {} as never,
                {} as never,
            );
            const text = (ok.output as { text: string }[])[0]!.text;
            expect(JSON.parse(text)).toMatchObject({ diff: 0.5, method: expect.stringContaining("fake") });
            expect(ok.isError).toBeUndefined();

            // The fake server throws on missing scores; the plugin error must reach the model, not the harness.
            const bad = await compare.execute({}, {} as never, {} as never);
            expect(bad.isError).toBe(true);
            expect((bad.output as { text: string }[])[0]!.text).toContain("fake-stats-mcp");
        } finally {
            await plugins.close();
        }
    });

    test("a plugin that cannot start is reported and leaves the rest working", async () => {
        const dir = join(tmp, "broken");
        rmSync(dir, { recursive: true, force: true });
        const { mkdirSync } = await import("node:fs");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            name: "broken",
            version: "0.1.0",
            description: "never starts",
            domain: "stats",
            capabilities: ["stats.compare_eval_runs@1"],
            transport: { type: "mcp", command: "definitely-not-a-real-command-dataclaw" },
        }));

        const errors: string[] = [];
        const plugins = await createPluginAgentTools({ paths: [dir, FAKE_MCP], root: tmp, onError: (m) => errors.push(m) });
        try {
            expect(errors.some((m) => m.includes("broken") && m.includes("could not start"))).toBe(true);
            expect(plugins.toolNames).toContain("fake-stats-mcp__compare_eval_runs");
        } finally {
            await plugins.close();
        }
    });

    test("a script plugin is described as capabilities-only, not as an error", async () => {
        const errors: string[] = [];
        const plugins = await createPluginAgentTools({ paths: [KAPPA_SCRIPT], root: tmp, onError: (message) => errors.push(message) });
        try {
            expect(errors).toEqual([]);
            expect(plugins.errors).toEqual([]);
            expect(plugins.capabilitiesOnly).toEqual(["kappa-script"]);
            expect(plugins.toolNames).toEqual([]);
            expect(plugins.extensions).toEqual([]);
            expect(plugins.plugins).toEqual([
                expect.objectContaining({ name: "kappa-script", capabilitiesOnly: true, tools: [], mcpTools: [], timeoutMs: PLUGIN_TIMEOUT_MS }),
            ]);
        } finally {
            await plugins.close();
        }
    });

    test("the harness installs plugin tools and tool_search; disabling it spawns nothing", async () => {
        const previous = process.env.DATACLAW_PLUGIN_PATH;
        process.env.DATACLAW_PLUGIN_PATH = FAKE_MCP;
        const faux = fauxProvider({ provider: "faux", models: [{ id: "probe" }] });
        try {
            const analyst = await createAnalystHarness({
                storagePath: ":memory:",
                resume: false,
                databricks: false,
                fauxHandle: faux,
                model: { provider: "faux", modelId: "probe" },
                projectRoot: join(tmp, "harness"),
                workspaceDir: join(tmp, "harness", "workspace"),
            });
            try {
                expect(analyst.pluginTools?.toolNames).toContain("fake-stats-mcp__compare_eval_runs");
                const installed = analyst.registry.snapshot().installed().map((e) => e.name);
                expect(installed).toContain("plugin:fake-stats-mcp");
                expect(installed).toContain("tool-search");
            } finally {
                await analyst.close();
            }

            const off = await createAnalystHarness({
                storagePath: ":memory:",
                resume: false,
                databricks: false,
                fauxHandle: fauxProvider({ provider: "faux", models: [{ id: "probe" }] }),
                model: { provider: "faux", modelId: "probe" },
                projectRoot: join(tmp, "harness-off"),
                workspaceDir: join(tmp, "harness-off", "workspace"),
                pluginTools: false,
            });
            try {
                expect(off.pluginTools).toBeUndefined();
                expect(off.registry.snapshot().installed().map((e) => e.name)).not.toContain("plugin:fake-stats-mcp");
            } finally {
                await off.close();
            }
        } finally {
            if (previous === undefined) delete process.env.DATACLAW_PLUGIN_PATH;
            else process.env.DATACLAW_PLUGIN_PATH = previous;
        }
    }, 60_000);
});
