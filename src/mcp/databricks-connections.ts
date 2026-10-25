import type { ConnectionName } from "../types/brands";
import { parseConnectionName } from "../types/brands";

export interface DatabricksConnectionInfo {
    readonly name: ConnectionName;
    readonly connectionType: "POSTGRESQL" | "SNOWFLAKE" | "BIGQUERY" | "MYSQL" | "REDSHIFT" | "SQLSERVER" | string;
    readonly comment?: string;
    readonly host?: string;
    readonly port?: number;
    readonly user?: string;
    readonly database?: string;
    readonly createdAt?: number;
    readonly updatedAt?: number;
}

export interface DatabricksConnectionsOptions {
    readonly host: string;
    readonly token: string;
    readonly fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export class DatabricksConnectionsClient {
    private readonly host: string;
    private readonly token: string;
    private readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

    constructor(options: DatabricksConnectionsOptions) {
        this.host = options.host.replace(/\/$/, "");
        this.token = options.token;
        this.fetch = options.fetchFn ?? globalThis.fetch;
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.host}${endpoint}`;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string> | undefined),
        };

        const res = await this.fetch(url, { ...options, headers });
        if (!res.ok) {
            let errorText = "";
            try {
                const json = (await res.json()) as { message?: string; error?: string };
                errorText = json.message || json.error || JSON.stringify(json);
            } catch {
                errorText = await res.text();
            }
            throw new Error(`Databricks Connections API error (${res.status} ${res.statusText}): ${errorText}`);
        }
        return (await res.json()) as T;
    }

    async listConnections(): Promise<readonly DatabricksConnectionInfo[]> {
        const res = await this.request<{
            connections?: Array<{
                name: string;
                connection_type: string;
                comment?: string;
                options?: Record<string, string>;
                created_at?: number;
                updated_at?: number;
            }>;
        }>("/api/2.0/connections", { method: "GET" });

        if (!res.connections) return [];

        return res.connections.map((c) => ({
            name: parseConnectionName(c.name),
            connectionType: c.connection_type,
            comment: c.comment,
            host: c.options?.host,
            port: c.options?.port ? Number.parseInt(c.options.port, 10) : undefined,
            user: c.options?.user,
            database: c.options?.database,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
        }));
    }

    async getConnection(name: string): Promise<DatabricksConnectionInfo | null> {
        try {
            const res = await this.request<{
                name: string;
                connection_type: string;
                comment?: string;
                options?: Record<string, string>;
                created_at?: number;
                updated_at?: number;
            }>(`/api/2.0/connections/${encodeURIComponent(name)}`, { method: "GET" });

            return {
                name: parseConnectionName(res.name),
                connectionType: res.connection_type,
                comment: res.comment,
                host: res.options?.host,
                port: res.options?.port ? Number.parseInt(res.options.port, 10) : undefined,
                user: res.options?.user,
                database: res.options?.database,
                createdAt: res.created_at,
                updatedAt: res.updated_at,
            };
        } catch {
            return null;
        }
    }
}
