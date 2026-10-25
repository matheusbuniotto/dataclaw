import type { GenieSpaceId } from "../types/brands";
import { parseGenieSpaceId } from "../types/brands";

export interface GenieSpace {
    readonly spaceId: GenieSpaceId;
    readonly title: string;
    readonly description?: string;
    readonly warehouseId?: string;
}

export interface GenieMessageResult {
    readonly messageId: string;
    readonly conversationId: string;
    readonly status: "COMPLETED" | "EXECUTING" | "FAILED" | "SUBMITTED";
    readonly content?: string;
    readonly sqlQuery?: string;
    readonly queryDescription?: string;
    readonly error?: string;
}

export interface DatabricksGenieOptions {
    readonly host: string;
    readonly token: string;
    readonly fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export class DatabricksGenieClient {
    private readonly host: string;
    private readonly token: string;
    private readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

    constructor(options: DatabricksGenieOptions) {
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
            throw new Error(`Databricks Genie API error (${res.status} ${res.statusText}): ${errorText}`);
        }
        return (await res.json()) as T;
    }

    async listSpaces(): Promise<readonly GenieSpace[]> {
        const res = await this.request<{
            spaces?: Array<{
                space_id: string;
                title: string;
                description?: string;
                warehouse_id?: string;
            }>;
        }>("/api/2.0/genie/spaces", { method: "GET" });

        if (!res.spaces) return [];

        return res.spaces.map((s) => ({
            spaceId: parseGenieSpaceId(s.space_id),
            title: s.title,
            description: s.description,
            warehouseId: s.warehouse_id,
        }));
    }

    async startConversation(spaceId: GenieSpaceId, question: string): Promise<{ conversationId: string; messageId: string }> {
        const res = await this.request<{
            conversation_id: string;
            message_id: string;
        }>(`/api/2.0/genie/spaces/${encodeURIComponent(spaceId)}/start-conversation`, {
            method: "POST",
            body: JSON.stringify({ content: question }),
        });
        return {
            conversationId: res.conversation_id,
            messageId: res.message_id,
        };
    }

    async pollMessage(
        spaceId: GenieSpaceId,
        conversationId: string,
        messageId: string,
        timeoutMs = 60_000,
        intervalMs = 1_000,
    ): Promise<GenieMessageResult> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const res = await this.request<{
                id: string;
                conversation_id: string;
                status: "COMPLETED" | "EXECUTING" | "FAILED" | "SUBMITTED";
                content?: string;
                attachments?: Array<{
                    query?: {
                        query?: string;
                        description?: string;
                    };
                }>;
                error?: { message?: string };
            }>(`/api/2.0/genie/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
                method: "GET",
            });

            if (res.status === "COMPLETED" || res.status === "FAILED") {
                const queryAttachment = res.attachments?.find((a) => a.query);
                return {
                    messageId: res.id,
                    conversationId: res.conversation_id,
                    status: res.status,
                    content: res.content,
                    sqlQuery: queryAttachment?.query?.query,
                    queryDescription: queryAttachment?.query?.description,
                    error: res.error?.message,
                };
            }

            await new Promise((r) => setTimeout(r, intervalMs));
        }

        throw new Error(`Databricks Genie poll timed out after ${timeoutMs}ms`);
    }

    async ask(spaceId: GenieSpaceId, question: string, timeoutMs = 60_000): Promise<GenieMessageResult> {
        const { conversationId, messageId } = await this.startConversation(spaceId, question);
        return this.pollMessage(spaceId, conversationId, messageId, timeoutMs);
    }
}
