import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCapability } from "./manifest";
import { PluginError, type CapabilityId, type LoadedPlugin, type McpTransportConfig, type PluginClient, type ScriptTransportConfig } from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const STDERR_TAIL = 4000;

function childEnv(extra?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    return { ...env, ...(extra ?? {}) };
}

/** Default MCP tool for a capability: `stats.compare_eval_runs@1` -> `compare_eval_runs`. */
export function defaultToolName(capability: CapabilityId): string {
    return parseCapability(capability).name;
}

/** Parse a tool result: structured content first (unwrapping `{result: ...}`), else JSON text. */
export function toolResultValue(result: Record<string, unknown>, plugin: string): unknown {
    const text = Array.isArray(result.content)
        ? result.content.filter((c): c is { type: "text"; text: string } => c?.type === "text").map((c) => c.text).join("\n")
        : "";
    if (result.isError) throw new PluginError(`tool returned an error: ${text || "(no message)"}`, plugin);
    const sc = result.structuredContent;
    if (sc && typeof sc === "object") {
        const keys = Object.keys(sc);
        return keys.length === 1 && keys[0] === "result" ? (sc as { result: unknown }).result : sc;
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new PluginError("tool result is neither structured content nor JSON text", plugin);
    }
}

/** Model Context Protocol over stdio, using the official TypeScript SDK client. */
export class McpPluginClient implements PluginClient {
    private client?: Client;
    private transport?: StdioClientTransport;
    private stderr = "";
    private tools?: Set<string>;

    constructor(readonly plugin: LoadedPlugin, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

    private get config(): McpTransportConfig {
        return this.plugin.manifest.transport as McpTransportConfig;
    }

    private async connect(): Promise<Client> {
        if (this.client) return this.client;
        const cfg = this.config;
        this.transport = new StdioClientTransport({
            command: cfg.command,
            args: cfg.args ?? [],
            env: childEnv(cfg.env),
            cwd: this.plugin.cwd,
            stderr: "pipe",
        });
        this.transport.stderr?.on("data", (chunk: Buffer) => {
            this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL);
        });
        const client = new Client({ name: "dataclaw", version: "1" });
        try {
            await client.connect(this.transport, { timeout: this.timeoutMs });
            const listed = await client.listTools(undefined, { timeout: this.timeoutMs });
            this.tools = new Set(listed.tools.map((t) => t.name));
        } catch (err) {
            await this.close();
            throw new PluginError(`could not start MCP server "${cfg.command}": ${err instanceof Error ? err.message : String(err)}${this.stderrHint()}`, this.plugin.manifest.name);
        }
        for (const cap of this.plugin.manifest.capabilities) {
            const tool = this.toolFor(cap);
            if (!this.tools.has(tool)) {
                await this.close();
                throw new PluginError(`declares ${cap} but its MCP server has no tool "${tool}" (tools: ${[...this.tools].sort().join(", ")})`, this.plugin.manifest.name);
            }
        }
        this.client = client;
        return client;
    }

    private stderrHint(): string {
        return this.stderr.trim() ? `\nserver stderr (tail):\n${this.stderr.trim()}` : "";
    }

    toolFor(capability: CapabilityId): string {
        return this.config.tools?.[capability] ?? defaultToolName(capability);
    }

    /** Tool names the server listed (after connecting). */
    async listTools(): Promise<string[]> {
        await this.connect();
        return [...this.tools!].sort();
    }

    async invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown> {
        if (!this.plugin.manifest.capabilities.includes(capability)) {
            throw new PluginError(`does not provide ${capability}`, this.plugin.manifest.name);
        }
        const client = await this.connect();
        const result = await client.callTool({ name: this.toolFor(capability), arguments: input }, undefined, { timeout: this.timeoutMs });
        return toolResultValue(result, this.plugin.manifest.name);
    }

    async close(): Promise<void> {
        const client = this.client;
        const transport = this.transport;
        this.client = undefined;
        this.transport = undefined;
        if (client) await client.close().catch(() => {});
        else if (transport) await transport.close().catch(() => {});
    }
}

/**
 * The simplest transport: run `command args...` once per call, write
 * `{"capability": id, "input": {...}}` to stdin, read one JSON object from stdout:
 * `{"output": ...}` on success or `{"error": "message"}`. Non-zero exit is an error.
 */
export class ScriptPluginClient implements PluginClient {
    constructor(readonly plugin: LoadedPlugin, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

    async invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown> {
        const name = this.plugin.manifest.name;
        if (!this.plugin.manifest.capabilities.includes(capability)) throw new PluginError(`does not provide ${capability}`, name);
        const cfg = this.plugin.manifest.transport as ScriptTransportConfig;
        let proc: ReturnType<typeof Bun.spawn>;
        try {
            proc = Bun.spawn([cfg.command, ...(cfg.args ?? [])], {
                cwd: this.plugin.cwd,
                env: childEnv(cfg.env),
                stdin: new Blob([JSON.stringify({ capability, input })]),
                stdout: "pipe",
                stderr: "pipe",
            });
        } catch (err) {
            throw new PluginError(`could not run "${cfg.command}": ${err instanceof Error ? err.message : String(err)}`, name);
        }
        const timer = setTimeout(() => proc.kill(), this.timeoutMs);
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout as ReadableStream).text(),
            new Response(proc.stderr as ReadableStream).text(),
            proc.exited,
        ]);
        clearTimeout(timer);
        const tail = stderr.trim() ? `\nstderr (tail):\n${stderr.trim().slice(-STDERR_TAIL)}` : "";
        if (code !== 0) throw new PluginError(`script exited with code ${code}${tail}`, name);
        let reply: unknown;
        try {
            reply = JSON.parse(stdout);
        } catch {
            throw new PluginError(`script did not print one JSON object on stdout${tail}`, name);
        }
        if (reply && typeof reply === "object" && "error" in reply) throw new PluginError(String((reply as { error: unknown }).error), name);
        if (!reply || typeof reply !== "object" || !("output" in reply)) throw new PluginError(`script reply has no "output"`, name);
        return (reply as { output: unknown }).output;
    }

    async close(): Promise<void> {}
}

export function openPlugin(plugin: LoadedPlugin, options: { timeoutMs?: number } = {}): PluginClient {
    return plugin.manifest.transport.type === "mcp"
        ? new McpPluginClient(plugin, options.timeoutMs)
        : new ScriptPluginClient(plugin, options.timeoutMs);
}
