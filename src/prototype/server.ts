// Stillwork: Durable Agent Data Platform (DataClaw Console)
//
// The console's entry point and its only listener. The API itself lives in `routes.ts`, which
// imports nothing that binds a port, so it can be exercised in a test without starting this.
import indexHtml from "./index.html";
import { handle, respond } from "./routes";

const PAGES = ["/", "/prototype", "/prototype/agents", "/prototype/runs", "/prototype/data", "/prototype/capabilities", "/prototype/settings"];

/**
 * Start the console. `/api/*` is one route table (`handle`); the pages are the same HTML app,
 * which routes on the client.
 */
export function startServer(options: { port?: number; hostname?: string } = {}) {
    // Local-only by default: the auth endpoints can mint Databricks sessions.
    const port = options.port ?? (Number(process.env.PORT) || 3000);
    const hostname = options.hostname ?? process.env.HOST ?? "127.0.0.1";

    const server = Bun.serve({
        port,
        hostname,
        // The first workspace open can spend time on Databricks MCP auth.
        idleTimeout: 60,
        routes: Object.fromEntries(PAGES.map((path) => [path, indexHtml])),
        // Everything else is the API table; an unknown path answers a JSON 404.
        fetch: (request) => handle(request),
        development: {
            hmr: true,
            console: true,
        },
        error(error) {
            return respond(() => { throw error; });
        },
    });

    const base = `http://localhost:${server.port}`;
    console.log("\n==========================================================");
    console.log("  STILLWORK: DURABLE AGENT DATA PLATFORM");
    console.log("==========================================================");
    console.log(`\n  🚀 URL: ${base}/prototype`);
    console.log(`\n  Pages:`);
    console.log(`  - Overview:     ${base}/prototype`);
    console.log(`  - Agents:       ${base}/prototype/agents`);
    console.log(`  - Durable runs: ${base}/prototype/runs`);
    console.log(`  - Data health:  ${base}/prototype/data`);
    console.log(`  - Capabilities: ${base}/prototype/capabilities`);
    console.log(`  - Settings:     ${base}/prototype/settings`);
    console.log(`  - Databricks:   ${base}/api/databricks/status`);
    console.log(`  - Main agent:   ${base}/api/workspace`);
    console.log("==========================================================\n");
    return server;
}

if (import.meta.main) startServer();
