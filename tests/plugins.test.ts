import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    McpPluginClient,
    PluginError,
    ScriptPluginClient,
    discoverPlugins,
    parseCapability,
    providers,
    resolveCapability,
    validateManifest,
    type LoadedPlugin,
    type PluginManifest,
} from "../src/plugins";
import { agreementKappa, compareEvalRuns } from "../src/plugins/capabilities/stats";
import { compareRuns } from "../evals/compare";
import { episodesToMatrix, preparePaired } from "../evals/shape";
import { cohensKappa } from "../evals/stats";
import { labelPairs, pluginKappa, parseCsv } from "../evals/calibrate";
import type { EpisodeResult } from "../evals/run";

const FAKE_MCP = resolve(import.meta.dir, "fixtures/plugins/fake-stats-mcp");
const KAPPA_SCRIPT = resolve(import.meta.dir, "../examples/plugins/kappa-script");
const tmp = mkdtempSync(join(tmpdir(), "dataclaw-plugins-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
    name: "p",
    version: "1.0.0",
    description: "d",
    domain: "stats",
    capabilities: ["stats.compare_eval_runs@1"],
    transport: { type: "script", command: "true" },
    ...over,
});

const loaded = (m: PluginManifest, cwd = tmp): LoadedPlugin => ({ manifest: m, source: join(cwd, "plugin.json"), cwd });

function episode(variant: string, taskId: string, repeat: number, success: boolean, over: Partial<EpisodeResult> = {}): EpisodeResult {
    return {
        variant, taskId, repeat, model: "faux/x", mode: "model", expected: 1, success,
        stuck: { stuck: !success, reasons: success ? [] : ["no_final_answer"], maxRepeats: 0, longestErrorStreak: 0, shippedRejectedFinding: false },
        toolCalls: 3, toolErrors: 0, tools: [], findings: [],
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
        costUsd: 0.01, costSource: "provider", latencyMs: 100, ...over,
    };
}

const grid = (variant: string, tasks: number, repeats: number, pass: (t: number, r: number) => boolean, over: Partial<EpisodeResult> = {}) =>
    Array.from({ length: repeats }, (_, r) => Array.from({ length: tasks }, (_, t) => episode(variant, `t${t}`, r, pass(t, r), over))).flat();

describe("manifests", () => {
    test("capability ids are domain.name@major", () => {
        expect(parseCapability("stats.compare_eval_runs@1")).toEqual({ domain: "stats", name: "compare_eval_runs", major: 1 });
        expect(parseCapability("ml.forecast.arima@2").name).toBe("forecast.arima");
        expect(() => parseCapability("compare@1")).toThrow(PluginError);
        expect(() => parseCapability("stats.compare")).toThrow(PluginError);
    });

    test("validation names the problem", () => {
        expect(validateManifest(manifest(), "x.json").name).toBe("p");
        expect(() => validateManifest({ ...manifest(), capabilities: [] }, "x.json")).toThrow(/capabilities/);
        expect(() => validateManifest({ ...manifest(), transport: { type: "http", command: "x" } }, "x.json")).toThrow(/transport.type/);
        expect(() => validateManifest({ ...manifest(), name: "Bad Name" }, "x.json")).toThrow(/name/);
        expect(() =>
            validateManifest({ ...manifest(), transport: { type: "mcp", command: "x", tools: { "stats.other@1": "t" } } }, "x.json"),
        ).toThrow(/not in capabilities/);
    });

    test("discovery: plugins/ dir, dataclaw.plugins.json, DATACLAW_PLUGIN_PATH; duplicates rejected", () => {
        const root = join(tmp, "root");
        mkdirSync(join(root, "plugins", "a"), { recursive: true });
        writeFileSync(join(root, "plugins", "a", "plugin.json"), JSON.stringify(manifest({ name: "a" })));
        writeFileSync(join(root, "dataclaw.plugins.json"), JSON.stringify({ plugins: [manifest({ name: "b", transport: { type: "script", command: "x", cwd: "sub" } })] }));
        const found = discoverPlugins({ root, paths: [KAPPA_SCRIPT] });
        expect(found.map((p) => p.manifest.name)).toEqual(["a", "b", "kappa-script"]);
        expect(found[1]!.cwd).toBe(join(root, "sub"));
        expect(found[2]!.cwd).toBe(KAPPA_SCRIPT);
        expect(() => discoverPlugins({ root, paths: [join(root, "plugins", "a")] })).toThrow(/declared twice/);
        expect(discoverPlugins({ root: join(tmp, "empty-root"), paths: [] })).toEqual([]);
    });

    test("resolution: priority, then name; explicit preference wins or errors", () => {
        const ps = [loaded(manifest({ name: "low" })), loaded(manifest({ name: "high", priority: 5 })), loaded(manifest({ name: "other", capabilities: ["ml.forecast@1"] }))];
        expect(providers(ps, "stats.compare_eval_runs@1").map((p) => p.manifest.name)).toEqual(["high", "low"]);
        expect(providers(ps, "stats.compare_eval_runs@1", "low")[0]!.manifest.name).toBe("low");
        expect(() => providers(ps, "stats.compare_eval_runs@1", "other")).toThrow(/does not provide/);
        expect(providers(ps, "stats.compare_eval_runs@2")).toEqual([]);
        expect(resolveCapability(compareEvalRuns, { plugins: [] })).toBeUndefined();
    });
});

describe("mcp transport (fake stats server over stdio)", () => {
    const fake = () => discoverPlugins({ root: join(tmp, "none"), paths: [FAKE_MCP] });

    test("handshake lists the tools, calls a capability, validates the contract", async () => {
        const client = new McpPluginClient(fake()[0]!);
        try {
            expect(await client.listTools()).toEqual(["agreement_kappa", "compare_eval_runs"]);
            const raw = await client.invoke("stats.compare_eval_runs@1", { scores_a: [[0, 1], [1, 1]], scores_b: [[1, 1], [1, 1]], paired: true, alpha: 0.05, ci_method: "analytic" });
            const out = compareEvalRuns.parseOutput(raw);
            expect(out.diff).toBeCloseTo(0.25, 12);
            expect(out.mean_a).toBeCloseTo(0.75, 12);
            expect(out.method).toContain("ci_method=analytic");
        } finally {
            await client.close();
        }
    });

    test("a declared capability without a matching tool fails at connect", async () => {
        const p = fake()[0]!;
        const broken = loaded({ ...p.manifest, capabilities: ["stats.compare_eval_runs@1", "stats.power@1"] }, p.cwd);
        const client = new McpPluginClient(broken);
        await expect(client.listTools()).rejects.toThrow(/no tool "power"/);
        await client.close();
    });

    test("output that breaks the contract is rejected with the plugin name", async () => {
        const p = fake()[0]!;
        const bad = loaded({ ...p.manifest, transport: { ...p.manifest.transport, env: { FAKE_MODE: "bad_output" } } }, p.cwd);
        const cap = resolveCapability(compareEvalRuns, { plugins: [bad] })!;
        try {
            await expect(cap.call({ scores_a: [[1, 0]], scores_b: [[1, 1]], paired: true, alpha: 0.05, ci_method: "analytic" })).rejects.toThrow(
                /\[plugin fake-stats-mcp\] output does not match stats.compare_eval_runs@1: "diff"/,
            );
        } finally {
            await cap.close();
        }
    });

    test("a server that cannot start gives a clear error", async () => {
        const client = new McpPluginClient(loaded(manifest({ name: "gone", transport: { type: "mcp", command: "bun", args: ["does-not-exist.ts"] } })));
        await expect(client.listTools()).rejects.toThrow(/\[plugin gone\] could not start MCP server/);
        await client.close();
    });
});

describe("script transport (example kappa plugin)", () => {
    test("matches DataClaw's own kappa on the textbook 2x2 case", async () => {
        const [plugin] = discoverPlugins({ root: join(tmp, "none"), paths: [KAPPA_SCRIPT] });
        const a = [...Array(25).fill("yes"), ...Array(25).fill("no")];
        const b = [...Array(20).fill("yes"), ...Array(5).fill("no"), ...Array(10).fill("yes"), ...Array(15).fill("no")];
        const cap = resolveCapability(agreementKappa, { plugins: [plugin!] })!;
        const out = await cap.call({ rater_a: a, rater_b: b, labels: ["yes", "no"], alpha: 0.05, n_resamples: 500 });
        expect(out.kappa).toBeCloseTo(0.4, 10);
        expect(out.kappa).toBeCloseTo(cohensKappa(a, b, ["yes", "no"]), 12);
        expect(out.confusion_matrix).toEqual([[20, 5], [10, 15]]);
        expect(out.ci[0]!).toBeLessThan(0.4);
        expect(out.ci[1]!).toBeGreaterThan(0.4);
    });

    test("script errors surface as PluginError", async () => {
        const [plugin] = discoverPlugins({ root: join(tmp, "none"), paths: [KAPPA_SCRIPT] });
        const client = new ScriptPluginClient(plugin!);
        await expect(client.invoke("stats.agreement_kappa@1", { rater_a: ["x"], rater_b: [], alpha: 0.05 })).rejects.toThrow(/equal length/);
        await expect(client.invoke("stats.compare_eval_runs@1", {})).rejects.toThrow(/does not provide/);
        const failing = new ScriptPluginClient(loaded(manifest({ name: "fails", transport: { type: "script", command: "sh", args: ["-c", "echo boom >&2; exit 3"] } })));
        await expect(failing.invoke("stats.compare_eval_runs@1", {})).rejects.toThrow(/exited with code 3[\s\S]*boom/);
    });
});

describe("eval shaping", () => {
    test("cases are tasks, runs are repeats", () => {
        const rows = grid("v", 3, 2, (t, r) => t !== 1 || r === 0);
        const m = episodesToMatrix(rows, "success");
        expect(m.tasks).toEqual(["t0", "t1", "t2"]);
        expect(m.scores).toEqual([[1, 1, 1], [1, 0, 1]]);
    });

    test("uneven repeats: error, drop_tasks, truncate", () => {
        const rows = grid("v", 3, 3, () => true).filter((e) => !(e.taskId === "t2" && e.repeat === 2));
        expect(() => episodesToMatrix(rows, "success")).toThrow(/uneven repeats: t2 \(missing repeats 2\)/);
        const dropped = episodesToMatrix(rows, "success", "drop_tasks");
        expect(dropped.tasks).toEqual(["t0", "t1"]);
        expect(dropped.warnings[0]).toContain("dropped tasks");
        const cut = episodesToMatrix(rows, "success", "truncate");
        expect(cut.scores.length).toBe(2);
        expect(cut.warnings[0]).toContain("kept the first 2");
        expect(() => episodesToMatrix([...rows, rows[0]!], "success")).toThrow(/duplicate episode/);
    });

    test("paired input: shared tasks, scripted and error warnings", () => {
        const a = grid("base", 3, 2, () => true, { mode: "scripted" });
        const b = grid("model", 4, 3, (t) => t !== 0, { error: "timeout" });
        const p = preparePaired(a, b, { metric: "success" });
        expect(p.tasks).toEqual(["t0", "t1", "t2"]);
        expect(p.scoresA.length).toBe(2);
        expect(p.scoresB.length).toBe(3);
        expect(p.warnings.join("\n")).toContain("only in B: [t3]");
        expect(p.warnings.join("\n")).toContain("A contains mode=scripted");
        expect(p.warnings.join("\n")).toContain("timeout x9");
        expect(() => preparePaired([...a, ...b], b, { metric: "success" })).toThrow(/several variants/);
    });
});

describe("evals:compare and evals:calibrate through plugins", () => {
    test("uses the installed plugin", async () => {
        const plugins = discoverPlugins({ root: join(tmp, "none"), paths: [FAKE_MCP] });
        const out = await compareRuns(grid("a", 3, 2, (t) => t > 0), grid("b", 3, 2, () => true), { plugins: { plugins } });
        expect(out.kind).toBe("plugin");
        if (out.kind !== "plugin") return;
        expect(out.result.diff).toBeCloseTo(1 / 3, 12);
        expect(out.markdown).toContain("Computed by plugin `fake-stats-mcp` 0.0.1");
        expect(out.markdown).toContain("fake server: no inference");
    });

    test("falls back to the built-in report when no plugin is installed", async () => {
        const out = await compareRuns(grid("a", 3, 2, () => true), grid("b", 3, 2, () => true), { plugins: { plugins: [] } });
        expect(out.kind).toBe("builtin");
        expect(out.markdown).toContain("No installed plugin provides stats.compare_eval_runs@1");
        expect(out.markdown).toContain("Success rate [95% CI]");
    });

    test("calibrate asks an agreement_kappa plugin, or none", async () => {
        const items = [
            { itemId: "1", taskId: "t", expected: "", title: "", observation: "", query: "", auditorVerdict: "confirmed" },
            { itemId: "2", taskId: "t", expected: "", title: "", observation: "", query: "", auditorVerdict: "caution" },
        ];
        const labels = parseCsv("item_id,human_label\n1,confirmed\n2,confirmed\n");
        const pairs = labelPairs(labels, items);
        expect(await pluginKappa(pairs, { plugins: [] })).toBeUndefined();
        const plugins = discoverPlugins({ root: join(tmp, "none"), paths: [KAPPA_SCRIPT] });
        const got = await pluginKappa(pairs, { plugins });
        expect(got!.plugin).toBe("kappa-script");
        expect(got!.result.confusion_matrix).toEqual([[1, 1, 0], [0, 0, 0], [0, 0, 0]]);
        expect(got!.result.warnings.join(" ")).toContain("single label");
    });
});
