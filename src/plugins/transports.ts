import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { HttpMcpClient, type McpToolDefinition } from "../mcp/http-mcp-client";
import { parseCapability } from "./manifest";
import { PluginError, pluginTimeoutMs, type CapabilityId, type HttpMcpTransportConfig, type LoadedPlugin, type McpTransportConfig, type PluginClient, type ScriptTransportConfig } from "./types";

export type { McpToolDefinition };

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
    if (result.isError) throw new PluginError(`tool returned an error: ${text || "(no message)"}`, { plugin, code: "call" });
    const sc = result.structuredContent;
    if (sc && typeof sc === "object") {
        const keys = Object.keys(sc);
        return keys.length === 1 && keys[0] === "result" ? (sc as { result: unknown }).result : sc;
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new PluginError("tool result is neither structured content nor JSON text", { plugin, code: "call" });
    }
}

/** What every MCP transport offers above `PluginClient`: the tools a plugin can publish. */
export interface McpToolClient extends PluginClient {
    listTools(): Promise<string[]>;
    listToolDefinitions(): Promise<McpToolDefinition[]>;
    callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
    close(): Promise<void>;
}

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expand `${NAME}` from the environment. A missing or empty variable is an error rather than an
 * empty string: a manifest that points at `${SNOWFLAKE_MCP_URL}` must fail loudly when it is unset.
 */
export function expandEnv(value: string, label: string): string {
    return value.replace(ENV_REFERENCE, (_match, name: string) => {
        const resolved = process.env[name];
        if (!resolved) throw new Error(`${label} requires the environment variable ${name}`);
        return resolved;
    });
}

/** Model Context Protocol over stdio, using the official TypeScript SDK client. */
export class McpPluginClient implements PluginClient, McpToolClient {
    private client?: Client;
    private transport?: StdioClientTransport;
    private stderr = "";
    private tools?: Set<string>;
    private definitions?: McpToolDefinition[];

    constructor(readonly plugin: LoadedPlugin, private readonly timeoutMs = pluginTimeoutMs()) {}

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
            this.definitions = listed.tools.map((t) => ({
                name: t.name,
                ...(t.description ? { description: t.description } : {}),
                inputSchema: t.inputSchema,
            }));
        } catch (err) {
            await this.close();
            throw new PluginError(`could not start MCP server "${cfg.command}": ${err instanceof Error ? err.message : String(err)}${this.stderrHint()}`, { plugin: this.plugin.manifest.name, code: "startup" });
        }
        for (const cap of this.plugin.manifest.capabilities) {
            const tool = this.toolFor(cap);
            if (!this.tools.has(tool)) {
                await this.close();
                throw new PluginError(`declares ${cap} but its MCP server has no tool "${tool}" (tools: ${[...this.tools].sort().join(", ")})`, { plugin: this.plugin.manifest.name, code: "startup" });
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

    /** Every tool the server lists, with the schema it publishes (after connecting). */
    async listToolDefinitions(): Promise<McpToolDefinition[]> {
        await this.connect();
        return [...(this.definitions ?? [])];
    }

    /**
     * Call any tool the server lists, by the server's own tool name. Unlike `invoke()`, the
     * name does not have to map to a declared capability, so a plugin can offer tools that
     * DataClaw hands to the agent through `<plugin>__<tool>` (see `agent-tools.ts`).
     */
    async callTool(name: string, args: Record<string, unknown>, options: { signal?: AbortSignal } = {}): Promise<unknown> {
        const client = await this.connect();
        if (!this.tools?.has(name)) {
            throw new PluginError(`has no tool "${name}" (tools: ${[...(this.tools ?? [])].sort().join(", ") || "none"})`, { plugin: this.plugin.manifest.name, code: "call" });
        }
        const result = await client.callTool(
            { name, arguments: args },
            undefined,
            { timeout: this.timeoutMs, ...(options.signal ? { signal: options.signal } : {}) },
        ).catch((err: unknown) => {
            // Attribute transport-level failures (a throwing server, a killed process) to the plugin.
            throw err instanceof PluginError ? err : new PluginError(err instanceof Error ? err.message : String(err), { plugin: this.plugin.manifest.name, code: "call" });
        });
        return toolResultValue(result, this.plugin.manifest.name);
    }

    async invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown> {
        if (!this.plugin.manifest.capabilities.includes(capability)) {
            throw new PluginError(`does not provide ${capability}`, { plugin: this.plugin.manifest.name, code: "manifest" });
        }
        return this.callTool(this.toolFor(capability), input);
    }

    async close(): Promise<void> {
        const client = this.client;
        const transport = this.transport;
        this.client = undefined;
        this.transport = undefined;
        this.definitions = undefined;
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
    constructor(readonly plugin: LoadedPlugin, private readonly timeoutMs = pluginTimeoutMs()) {}

    async invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown> {
        const name = this.plugin.manifest.name;
        if (!this.plugin.manifest.capabilities.includes(capability)) throw new PluginError(`does not provide ${capability}`, { plugin: name, code: "manifest" });
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
            throw new PluginError(`could not run "${cfg.command}": ${err instanceof Error ? err.message : String(err)}`, { plugin: name, code: "startup" });
        }
        const timer = setTimeout(() => proc.kill(), this.timeoutMs);
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout as ReadableStream).text(),
            new Response(proc.stderr as ReadableStream).text(),
            proc.exited,
        ]);
        clearTimeout(timer);
        const tail = stderr.trim() ? `\nstderr (tail):\n${stderr.trim().slice(-STDERR_TAIL)}` : "";
        if (code !== 0) throw new PluginError(`script exited with code ${code}${tail}`, { plugin: name, code: "call" });
        let reply: unknown;
        try {
            reply = JSON.parse(stdout);
        } catch {
            throw new PluginError(`script did not print one JSON object on stdout${tail}`, { plugin: name, code: "call" });
        }
        if (reply && typeof reply === "object" && "error" in reply) throw new PluginError(String((reply as { error: unknown }).error), { plugin: name, code: "call" });
        if (!reply || typeof reply !== "object" || !("output" in reply)) throw new PluginError(`script reply has no "output"`, { plugin: name, code: "call" });
        return (reply as { output: unknown }).output;
    }

    async close(): Promise<void> {}
}

export function openPlugin(plugin: LoadedPlugin, options: { timeoutMs?: number } = {}): PluginClient {
    const transport = plugin.manifest.transport;
    if (transport.type === "mcp-http") return new McpHttpPluginClient(plugin, options.timeoutMs);
    return transport.type === "mcp"
        ? new McpPluginClient(plugin, options.timeoutMs)
        : new ScriptPluginClient(plugin, options.timeoutMs);
}

/** The MCP client for a plugin, or undefined when its transport is a script. */
export function openMcpPlugin(plugin: LoadedPlugin, options: { timeoutMs?: number } = {}): McpToolClient | undefined {
    const transport = plugin.manifest.transport;
    if (transport.type === "mcp-http") return new McpHttpPluginClient(plugin, options.timeoutMs);
    if (transport.type === "mcp") return new McpPluginClient(plugin, options.timeoutMs);
    return undefined;
}

/**
 * Model Context Protocol over streamable HTTP, declared by a manifest's `mcp-http` transport.
 * Same surface as the stdio client, so everything above it is transport-neutral.
 */
export class McpHttpPluginClient implements PluginClient, McpToolClient {
    private http?: HttpMcpClient;
    private opening?: Promise<HttpMcpClient>;

    constructor(readonly plugin: LoadedPlugin, private readonly timeoutMs = pluginTimeoutMs()) {}

    private get config(): HttpMcpTransportConfig {
        return this.plugin.manifest.transport as HttpMcpTransportConfig;
    }

    private async connect(): Promise<HttpMcpClient> {
        if (this.http) return this.http;
        this.opening ??= this.open().catch((err: unknown) => {
            this.opening = undefined;
            throw err;
        });
        return this.opening;
    }

    private async open(): Promise<HttpMcpClient> {
        const name = this.plugin.manifest.name;
        const cfg = this.config;
        let url: string;
        const headers: Record<string, string> = {};
        try {
            url = expandEnv(cfg.url, "transport.url");
            for (const [key, value] of Object.entries(cfg.headers ?? {})) {
                headers[key] = expandEnv(value, `transport.headers.${key}`);
            }
        } catch (err) {
            throw new PluginError(err instanceof Error ? err.message : String(err), { plugin: name, code: "startup" });
        }

        const bearerEnv = cfg.bearerEnv;
        const tokenProvider = bearerEnv
            ? () => {
                const token = process.env[bearerEnv];
                if (!token) throw new PluginError(`requires the environment variable ${bearerEnv}`, { plugin: name, code: "startup" });
                return token;
            }
            : undefined;

        const http = await HttpMcpClient.connect({
            url,
            ...(Object.keys(headers).length ? { headers } : {}),
            ...(tokenProvider ? { tokenProvider } : {}),
            timeoutMs: this.timeoutMs,
        }).catch((err: unknown) => {
            throw err instanceof PluginError ? err : new PluginError(err instanceof Error ? err.message : String(err), { plugin: name, code: "startup" });
        });

        for (const cap of this.plugin.manifest.capabilities) {
            const tool = this.toolFor(cap);
            if (!http.availableTools.includes(tool)) {
                const available = http.availableTools.join(", ") || "none";
                await http.close();
                throw new PluginError(`declares ${cap} but its MCP server has no tool "${tool}" (tools: ${available})`, { plugin: name, code: "startup" });
            }
        }

        this.http = http;
        return http;
    }

    toolFor(capability: CapabilityId): string {
        return this.config.tools?.[capability] ?? defaultToolName(capability);
    }

    async listTools(): Promise<string[]> {
        return (await this.connect()).availableTools;
    }

    async listToolDefinitions(): Promise<McpToolDefinition[]> {
        return (await this.connect()).listToolDefinitions();
    }

    async callTool(name: string, args: Record<string, unknown>, options: { signal?: AbortSignal } = {}): Promise<unknown> {
        const http = await this.connect();
        const result = await http.callTool(name, args, { ...(options.signal ? { signal: options.signal } : {}) }).catch((err: unknown) => {
            throw err instanceof PluginError ? err : new PluginError(err instanceof Error ? err.message : String(err), { plugin: this.plugin.manifest.name, code: "call" });
        });
        return toolResultValue(result as Record<string, unknown>, this.plugin.manifest.name);
    }

    async invoke(capability: CapabilityId, input: Record<string, unknown>): Promise<unknown> {
        if (!this.plugin.manifest.capabilities.includes(capability)) {
            throw new PluginError(`does not provide ${capability}`, { plugin: this.plugin.manifest.name, code: "manifest" });
        }
        return this.callTool(this.toolFor(capability), input);
    }

    async close(): Promise<void> {
        const http = this.http;
        this.http = undefined;
        this.opening = undefined;
        await http?.close();
    }
}
