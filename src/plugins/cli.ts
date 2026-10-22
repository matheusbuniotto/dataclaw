import { discoverPluginHandles } from "./runtime";

/** `bun run plugins:list [--check]`: show installed plugins; `--check` starts MCP plugins and lists their tools. */
async function main() {
    const check = process.argv.includes("--check");
    const { handles, errors } = discoverPluginHandles();
    for (const error of errors) console.log(`FAILED: ${error.message}`);
    if (handles.length === 0) {
        console.log("No plugins installed. Add plugins/<name>/plugin.json, a dataclaw.plugins.json, or set DATACLAW_PLUGIN_PATH. See docs/plugins.md.");
        return;
    }
    for (const handle of handles) {
        const m = handle.plugin.manifest;
        console.log(`${m.name} ${m.version} [${m.domain}] (${m.transport.type}, priority ${m.priority ?? 0})`);
        console.log(`  ${m.description}`);
        console.log(`  capabilities: ${m.capabilities.join(", ")}`);
        console.log(`  manifest: ${handle.plugin.source}`);
        if (check) {
            if (!handle.publishesTools) {
                console.log("  capabilities only: a script transport publishes no tools to check");
                continue;
            }
            try {
                const tools = (await handle.tools()).map((tool) => tool.name);
                console.log(`  ok, tools: ${tools.join(", ")}`);
            } catch (err) {
                console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
                process.exitCode = 1;
            } finally {
                await handle.close();
            }
        }
    }
}

if (import.meta.main) await main();
