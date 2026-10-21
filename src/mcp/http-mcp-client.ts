/**
 * Model Context Protocol over streamable HTTP.
 *
 * One transport for every HTTP MCP server: Databricks' managed SQL endpoint, and any data MCP
 * a plugin manifest declares. It owns what is wire-shaped and nothing that is provider-shaped:
 * connecting, listing tools, calling one, re-minting a bearer token once after an auth failure,
 * and cancelling a call. Interpreting a result (SQL rows, a capability's payload) stays with the
 * caller.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/** A 401/403 that a fresh token might fix. */
const AUTH_FAILURE = /401|403|unauthori[sz]ed|forbidden|invalid[ _-]?token|token[ _-]?expired/i;

export interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema: unknown;
}

/** The raw `tools/call` result, before any interpretation. */
export interface McpToolCallResult {
    content?: unknown;
    structuredContent?: unknown;
    isError?: boolean;
    [key: string]: unknown;
}

export interface HttpMcpClientOptions {
    url: string;
    /** Sent on every request. `Authorization` is added when a token provider is set. */
    headers?: Record<string, string>;
    /** Bearer token source. Called with `force` to re-mint after an auth failure. */
    tokenProvider?: (force?: boolean) => string | Promise<string>;
    clientName?: string;
    clientVersion?: string;
    /** Per-request timeout. Default 120s. */
    timeoutMs?: number;
}

export function stoppedError(): Error {
    const error = new Error("Stopped.");
    error.name = "AbortError";
    return error;
}

export function isStoppedError(err: unknown): boolean {
    return err instanceof Error && (err.name === "AbortError" || err.message === "Stopped.");
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function throwIfStopped(signal?: AbortSignal): void {
    if (signal?.aborted) throw stoppedError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfStopped(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(finish, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(stoppedError());
        };
        function finish() {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Reject as soon as `signal` aborts, even if the SDK call is still waiting on the network.
 * Returns the call's value otherwise.
 */
async function raceAbort<T>(call: Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfStopped(signal);
    if (!signal) return call;
    let stopListening = () => {};
    const stopped = new Promise<never>((_, reject) => {
        const onAbort = () => reject(stoppedError());
        signal.addEventListener("abort", onAbort, { once: true });
        stopListening = () => signal.removeEventListener("abort", onAbort);
    });
    try {
        return await Promise.race([call, stopped]);
    } finally {
        stopListening();
    }
}

export class HttpMcpClient {
    private constructor(
        private client: Client,
        private readonly options: HttpMcpClientOptions,
        private tools: Set<string>,
        private definitions: McpToolDefinition[],
    ) {}

    static async connect(options: HttpMcpClientOptions): Promise<HttpMcpClient> {
        const opened = await HttpMcpClient.open(options, false);
        return new HttpMcpClient(opened.client, options, opened.tools, opened.definitions);
    }

    private static async open(
        options: HttpMcpClientOptions,
        force: boolean,
    ): Promise<{ client: Client; tools: Set<string>; definitions: McpToolDefinition[] }> {
        const headers: Record<string, string> = { ...(options.headers ?? {}) };
        if (options.tokenProvider) {
            headers.Authorization = `Bearer ${await options.tokenProvider(force)}`;
        }
        const transport = new StreamableHTTPClientTransport(new URL(options.url), {
            requestInit: { headers },
        });
        const client = new Client({
            name: options.clientName ?? "dataclaw",
            version: options.clientVersion ?? "0.1.0",
        });

        try {
            await client.connect(transport);
        } catch (err) {
            await client.close().catch(() => {});
            throw new Error(`Failed to connect to MCP server at ${options.url}: ${messageOf(err)}`);
        }

        try {
            const listed = await client.listTools(undefined, { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
            return {
                client,
                tools: new Set(listed.tools.map((tool) => tool.name)),
                definitions: listed.tools.map((tool) => ({
                    name: tool.name,
                    ...(tool.description ? { description: tool.description } : {}),
                    inputSchema: tool.inputSchema,
                })),
            };
        } catch (err) {
            await client.close().catch(() => {});
            throw new Error(`Connected to ${options.url} but could not list MCP tools: ${messageOf(err)}`);
        }
    }

    /** Tool names the server publishes, sorted. */
    get availableTools(): string[] {
        return [...this.tools].sort();
    }

    listTools(): string[] {
        return this.availableTools;
    }

    listToolDefinitions(): McpToolDefinition[] {
        return [...this.definitions];
    }

    /** Re-mint the token and reopen the connection after an auth failure. */
    private async refresh(): Promise<void> {
        const previous = this.client;
        const opened = await HttpMcpClient.open(this.options, true);
        this.client = opened.client;
        this.tools = opened.tools;
        this.definitions = opened.definitions;
        await previous.close().catch(() => {});
    }

    /**
     * Call one tool by the server's own name. Returns the raw result: interpreting
     * `structuredContent` or `content` is the caller's business.
     */
    async callTool(
        name: string,
        args: Record<string, unknown>,
        options: { signal?: AbortSignal } = {},
        attempt = 0,
    ): Promise<McpToolCallResult> {
        if (!this.tools.has(name)) {
            throw new Error(
                `MCP server does not expose "${name}". Available tools: ${this.availableTools.join(", ") || "none"}`,
            );
        }
        const signal = options.signal;
        throwIfStopped(signal);

        let result: McpToolCallResult | undefined;
        try {
            const call = this.client
                .callTool(
                    { name, arguments: args },
                    undefined,
                    { timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(signal ? { signal } : {}) },
                )
                .catch((err: unknown) => {
                    if (signal?.aborted || isStoppedError(err)) return undefined;
                    throw err;
                });
            result = await raceAbort(call, signal) as McpToolCallResult | undefined;
            if (result === undefined && signal?.aborted) throw stoppedError();
        } catch (err) {
            if (signal?.aborted || isStoppedError(err)) throw stoppedError();
            const message = messageOf(err);
            if (attempt === 0 && this.options.tokenProvider && AUTH_FAILURE.test(message)) {
                await this.refresh();
                return this.callTool(name, args, options, attempt + 1);
            }
            throw new Error(`MCP tool ${name} failed: ${message}`);
        }

        return result ?? {};
    }

    async close(): Promise<void> {
        await this.client.close().catch(() => {});
    }
}
