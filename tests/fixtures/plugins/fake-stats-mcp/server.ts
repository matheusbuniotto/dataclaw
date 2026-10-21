/**
 * Test-only MCP server for the plugin tests. It speaks real MCP over stdio (official SDK,
 * low-level Server API) and implements the two stats capabilities with plain arithmetic:
 * means, their difference, and raw agreement. It does no inference, and says so in `method`.
 * FAKE_MODE=bad_output returns a result that breaks the contract.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs: number[]) => (xs.length < 2 ? null : Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1)));

function compare(args: Record<string, unknown>) {
    const a = args.scores_a as number[][];
    const b = args.scores_b as number[][];
    const meanA = mean(a.flat());
    const meanB = mean(b.flat());
    return {
        diff: meanB - meanA,
        ci: [meanB - meanA, meanB - meanA],
        pvalue: null,
        run_to_run_std_a: std(a.map(mean)),
        run_to_run_std_b: std(b.map(mean)),
        mean_a: meanA,
        mean_b: meanB,
        n_cases: a[0]!.length,
        n_runs: { a: a.length, b: b.length },
        method: `fake test server (ci_method=${String(args.ci_method)}): point estimate only`,
        warnings: ["fake server: no inference"],
    };
}

function kappa(args: Record<string, unknown>) {
    const a = args.rater_a as string[];
    const b = args.rater_b as string[];
    const labels = (args.labels as string[] | undefined) ?? [...new Set([...a, ...b])].sort();
    const m = labels.map((r) => labels.map((c) => a.filter((x, i) => x === r && b[i] === c).length));
    return {
        kappa: null,
        ci: [null, null],
        agreement: a.filter((x, i) => x === b[i]).length / a.length,
        confusion_matrix: m,
        labels,
        n: a.length,
        method: "fake test server: raw agreement only",
        warnings: [],
    };
}

const server = new Server({ name: "fake-stats", version: "0.0.1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        { name: "compare_eval_runs", description: "fake", inputSchema: { type: "object" } },
        { name: "agreement_kappa", description: "fake", inputSchema: { type: "object" } },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    let out: unknown;
    if (process.env.FAKE_MODE === "bad_output") out = { diff: "not a number" };
    else if (req.params.name === "compare_eval_runs") out = compare(args);
    else if (req.params.name === "agreement_kappa") out = kappa(args);
    else return { isError: true, content: [{ type: "text", text: `unknown tool ${req.params.name}` }] };
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out as Record<string, unknown> };
});
await server.connect(new StdioServerTransport());
