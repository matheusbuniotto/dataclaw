import { discoverPlugins } from "./manifest";
import { McpPluginClient } from "./transports";

/** `bun run plugins:list [--check]`: show installed plugins; `--check` starts MCP plugins and lists their tools. */
async function main() {
    const check = process.argv.includes("--check");
    const plugins = discoverPlugins();
    if (plugins.length === 0) {
        console.log("No plugins installed. Add plugins/<name>/plugin.json, a dataclaw.plugins.json, or set DATACLAW_PLUGIN_PATH. See docs/plugins.md.");
        return;
    }
    for (const p of plugins) {
        const m = p.manifest;
        console.log(`${m.name} ${m.version} [${m.domain}] (${m.transport.type}, priority ${m.priority ?? 0})`);
        console.log(`  ${m.description}`);
        console.log(`  capabilities: ${m.capabilities.join(", ")}`);
        console.log(`  manifest: ${p.source}`);
        if (check && m.transport.type === "mcp") {
            const client = new McpPluginClient(p);
            try {
                console.log(`  ok, tools: ${(await client.listTools()).join(", ")}`);
            } catch (err) {
                console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
                process.exitCode = 1;
            } finally {
                await client.close();
            }
        }
    }
}

if (import.meta.main) await main();
