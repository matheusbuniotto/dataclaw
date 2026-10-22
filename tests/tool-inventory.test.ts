import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createAnalystHarness } from "../src/harness";
import { capabilityCatalog, setCapabilityEnabled } from "../src/capabilities/catalog";
import { featuresCreatePluginTool } from "../src/tools/feature-tools";
import { toolInventory } from "../src/tools/agent-tools";
import {
    AGENT_CAPABILITY_GROUPS,
    AGENT_CAPABILITY_NAMES,
    ANALYST_TOOLS,
    CODING_TOOLS,
    DATA_TOOLS,
    resolveAgentCapabilities,
} from "../src/docs/agent-capabilities";
import { declaredTools } from "../src/tools/inventory";

const FAKE_MCP_SERVER = resolve(import.meta.dir, "fixtures/plugins/fake-stats-mcp/server.ts");
const tmp = mkdtempSync(join(tmpdir(), "dataclaw-inventory-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function project(name: string): string {
    const root = join(tmp, name);
    mkdirSync(root, { recursive: true });
    return root;
}

async function harnessFor(root: string, pluginTools = false) {
    return createAnalystHarness({
        storagePath: ":memory:",
        resume: false,
        databricks: false,
        pluginTools,
        fauxHandle: fauxProvider({ provider: "faux", models: [{ id: "probe" }] }),
        model: { provider: "faux", modelId: "probe" },
        projectRoot: root,
        workspaceDir: join(root, "workspace"),
    });
}

/** Every tool name a capability group claims, `all` and `plugins` included (they claim none). */
const declaredUnion = (): string[] =>
    AGENT_CAPABILITY_NAMES.flatMap((id) => AGENT_CAPABILITY_GROUPS[id].tools);

describe("the tool inventory", () => {
    test("the capability groups are exactly the tools the harness installs", async () => {
        const analyst = await harnessFor(project("groups"));
        try {
            const entries = analyst.registry.snapshot().tools();
            const registeredBy = (extension: string): string[] =>
                entries.filter((entry) => entry.extension.name === extension).map((entry) => entry.tool.name);

            const coding = new Set<string>(CODING_TOOLS);
            const declaredWithoutCoding = [...new Set(declaredUnion())].filter((name) => !coding.has(name));
            // Every tool durable-analyst registers is in a group, and no group claims one it does not.
            expect(declaredWithoutCoding.sort()).toEqual(registeredBy("durable-analyst").sort());

            // The coding group belongs to the coding-tools extension, which nothing else provides.
            const declaredCoding: string[] = [...CODING_TOOLS];
            expect(declaredCoding.sort()).toEqual(registeredBy("coding-tools").sort());
            expect(declaredCoding).toEqual((CodingTools.tools ?? []).map((tool) => tool.name).sort());
        } finally {
            await analyst.close();
        }
    }, 60_000);

    test("the analyst group is the data tools plus its own, with nothing invented", () => {
        expect(DATA_TOOLS).toEqual(declaredTools("databricks"));
        expect(ANALYST_TOOLS).toEqual([...DATA_TOOLS, ...declaredTools("analyst")]);
        // The declaration table partitions the tools: no tool is declared in two groups.
        const owners = new Map<string, number>();
        for (const group of ["analyst", "databricks", "coding", "roster", "features"] as const) {
            for (const name of declaredTools(group)) owners.set(name, (owners.get(name) ?? 0) + 1);
        }
        expect([...owners].filter(([, count]) => count > 1)).toEqual([]);
    });

    test("every catalog tool row names installed tools", async () => {
        const analyst = await harnessFor(project("catalog"));
        try {
            const live = toolInventory(analyst.registry.snapshot()).tools;
            const catalog = await capabilityCatalog({
                projectRoot: analyst.projectRoot,
                workspaceDir: analyst.workspaceDir,
                loaded: analyst.pluginTools,
                databricks: { connected: false },
            });

            const rows = catalog.entries.filter((entry) => (entry.details.tools ?? []).length > 0);
            expect(rows.length).toBeGreaterThan(0);
            for (const entry of rows) {
                const missing = (entry.details.tools ?? []).filter((tool) => !live.has(tool));
                expect({ entry: entry.id, missing }).toEqual({ entry: entry.id, missing: [] });
            }

            // The row the console shows for `analyst` is the capability's own resolution: the
            // auto-improvement tools it used to omit are there, and nothing uninstalled is.
            const analystRow = catalog.entries.find((entry) => entry.id === "tool:analyst");
            expect(analystRow?.details.tools).toEqual([...ANALYST_TOOLS]);
            expect(catalog.entries.find((entry) => entry.id === "tool:coding")?.details.tools).toEqual([...CODING_TOOLS]);
        } finally {
            await analyst.close();
        }
    }, 60_000);

    test("an installed plugin's tools join the catalog after features_apply", async () => {
        const analyst = await harnessFor(project("plugin"), true);
        try {
            const created = await featuresCreatePluginTool.execute({
                name: "selfstats",
                description: "Self-authored stats tools for testing",
                domain: "stats",
                capabilities: [],
                transport: { type: "mcp", command: "bun", args: ["server.ts"] },
                files: [{ path: "server.ts", content: readFileSync(FAKE_MCP_SERVER, "utf8") }],
            }, {} as never, {} as never);
            expect(JSON.stringify(created)).toContain("selfstats");

            const reload = await analyst.reloadFeatures();
            expect(reload.toolNames).toContain("selfstats__compare_eval_runs");

            const live = toolInventory(analyst.registry.snapshot()).tools;
            const catalog = await capabilityCatalog({
                projectRoot: analyst.projectRoot,
                workspaceDir: analyst.workspaceDir,
                loaded: analyst.pluginTools,
                databricks: { connected: false },
            });
            const entry = catalog.entries.find((item) => item.id === "plugin:selfstats");
            expect(entry?.details.tools).toContain("selfstats__compare_eval_runs");
            for (const tool of entry?.details.tools ?? []) expect(live.has(tool)).toBe(true);
        } finally {
            await analyst.close();
        }
    }, 60_000);

    test("disabling tool:coding takes exactly the four coding tools out of the inventory", async () => {
        const root = project("no-coding");
        setCapabilityEnabled(root, "tool:coding", false);

        const analyst = await harnessFor(root);
        try {
            const inventory = toolInventory(analyst.registry.snapshot());
            const installed = new Set(inventory.tools.keys());
            expect(declaredUnion().filter((name) => !installed.has(name)).sort())
                .toEqual(["bash", "edit", "read", "write"]);
            expect([...CODING_TOOLS].filter((name) => installed.has(name))).toEqual([]);

            const resolution = resolveAgentCapabilities(["coding"], inventory);
            expect(resolution.extensions).not.toContain("coding-tools");

            // The console row keeps the names but reports the group as off, so the page can explain it.
            const catalog = await capabilityCatalog({ projectRoot: root, workspaceDir: join(root, "workspace") });
            const codingRow = catalog.entries.find((entry) => entry.id === "tool:coding");
            expect(codingRow?.enabled).toBe(false);
            expect(codingRow?.details.tools).toEqual([...CODING_TOOLS]);
        } finally {
            await analyst.close();
        }
    }, 60_000);
});
