/**
 * Databricks as a data-source provider: the managed SQL MCP endpoint behind the provider port.
 *
 * It is built in rather than declared by a manifest because its credential story (CLI profile
 * minting, OAuth refresh, a per-workspace endpoint derived from the host) is not expressible in a
 * manifest yet. The moment a manifest can name an OAuth refresher, this becomes one.
 */
import type { DatabricksMcpConfig } from "../../mcp/databricks-config";
import { resolveDatabricksConfig } from "../../mcp/databricks-config";
import { McpSqlClient } from "../../mcp/mcp-sql-client";
import { databricksDialect } from "../dialects";
import { SourceError, type ConnectIntent, type DataProvider, type SourceRecord } from "../types";
import { translateProviderError } from "./errors";

/** The durable record for a Databricks connection: names and URLs only, never a token. */
export interface DatabricksRecordInput {
    host?: string;
    mcpUrl?: string;
    profile?: string;
    connectedAt?: number;
}

export function databricksRecord(input: DatabricksRecordInput): SourceRecord {
    return {
        provider: "databricks",
        dialect: "databricks",
        ...(input.host ? { host: input.host } : {}),
        ...(input.mcpUrl ? { endpoint: input.mcpUrl } : {}),
        ...(input.profile ? { credential: { kind: "cli-profile", profile: input.profile } } : {}),
        connectedAt: input.connectedAt ?? Date.now(),
    };
}

export interface DatabricksProviderOptions {
    /** Where the endpoint and credential come from. Tests inject a fixed config. */
    resolve?: (intent: ConnectIntent) => DatabricksMcpConfig;
    /** Re-mints a token after an auth failure; the console's OAuth session plugs in here. */
    tokenFactory?: (force?: boolean) => string | Promise<string>;
}

export async function openDatabricksProvider(
    intent: ConnectIntent,
    options: DatabricksProviderOptions = {},
): Promise<DataProvider> {
    const resolve = options.resolve ?? ((wanted: ConnectIntent) => resolveDatabricksConfig({
        ...(wanted.host ? { host: wanted.host } : {}),
        ...(wanted.credential?.profile ? { profile: wanted.credential.profile } : {}),
    }));
    const tokenFactory = options.tokenFactory ?? (() => resolve(intent).token);

    let client: McpSqlClient | undefined;
    let host: string | undefined;
    let endpoint: string | undefined;

    const connect = async (): Promise<McpSqlClient> => {
        if (client) return client;
        try {
            const config = resolve(intent);
            host = config.host;
            endpoint = config.url;
            client = await McpSqlClient.connect(
                { ...config, token: await tokenFactory() },
                { tokenFactory },
            );
            return client;
        } catch (err) {
            throw translateProviderError(err, "databricks");
        }
    };

    return {
        id: "databricks",
        kind: "remote",
        dialect: databricksDialect,
        get host() {
            return host;
        },
        get endpoint() {
            return endpoint;
        },

        async probe() {
            const connected = await connect();
            const tools = connected.availableTools;
            if (tools.includes("execute_sql_read_only")) return { tools, readOnly: "tool" as const };
            if (tools.includes("execute_sql")) return { tools, readOnly: "checked" as const };
            throw new SourceError(
                "read-only-unavailable",
                "The Databricks MCP server publishes no SQL tool.",
                {
                    provider: "databricks",
                    available: tools,
                    hint: "Enable the managed SQL MCP endpoint for this workspace.",
                },
            );
        },

        async execute(sql: string, executeOptions = {}) {
            if (!databricksDialect.isReadOnly(sql)) {
                throw new SourceError("read-only-violation", "Only read-only SQL is permitted.", {
                    provider: "databricks",
                    hint: "Rephrase the statement as a query; mutations are blocked for safety.",
                });
            }
            if (executeOptions.signal?.aborted) {
                throw new SourceError("aborted", "Stopped.", { provider: "databricks" });
            }
            const connected = await connect();
            try {
                const result = await connected.execute(sql, {
                    readOnly: true,
                    maxRows: executeOptions.maxRows ?? 200,
                    ...(executeOptions.signal ? { signal: executeOptions.signal } : {}),
                });
                return {
                    columns: result.columns.map((column) => column.name),
                    rows: result.rows,
                    rowCount: result.rowCount,
                    executionTimeMs: result.executionTimeMs,
                };
            } catch (err) {
                throw translateProviderError(err, "databricks");
            }
        },

        async close() {
            const connected = client;
            client = undefined;
            await connected?.close();
        },
    };
}
