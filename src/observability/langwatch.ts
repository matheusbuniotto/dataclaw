import type { Transcript, TranscriptEvent } from "../transcript/types";

/**
 * LangWatch AI Agent Observability Integration.
 *
 * Implements OpenTelemetry-compatible tracing, LLM telemetry, tool execution spans,
 * auditor evaluations, and stuck-state guardrail logging for LangWatch (https://langwatch.ai).
 */

export interface LangWatchConfig {
    apiKey?: string;
    endpoint?: string;
    serviceName?: string;
    environment?: string;
}

export type SpanType = "llm" | "tool" | "chain" | "eval" | "guardrail";

export interface LangWatchSpan {
    span_id: string;
    parent_id?: string;
    type: SpanType;
    name: string;
    input?: unknown;
    output?: unknown;
    params?: Record<string, unknown>;
    metrics?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        duration_ms?: number;
    };
    timestamps: {
        started_at: number;
        completed_at?: number;
    };
    error?: string;
}

export interface LangWatchTrace {
    trace_id: string;
    metadata: {
        service_name: string;
        environment: string;
        thread_id?: string;
        user_id?: string;
        agent_id?: string;
        goal?: string;
        stuck?: boolean;
        stuck_reasons?: string[];
        [key: string]: unknown;
    };
    spans: LangWatchSpan[];
}

export interface SendTraceResult {
    ok: boolean;
    status: number | "buffered";
    error?: string;
}

export class LangWatchTracer {
    private readonly apiKey?: string;
    private readonly endpoint: string;
    private readonly serviceName: string;
    private readonly environment: string;
    private readonly buffer: LangWatchTrace[] = [];

    constructor(config: LangWatchConfig = {}) {
        this.apiKey = config.apiKey ?? process.env.LANGWATCH_API_KEY;
        this.endpoint = (config.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai").replace(/\/+$/, "");
        this.serviceName = config.serviceName ?? "dataclaw-analyst";
        this.environment = config.environment ?? process.env.NODE_ENV ?? "development";
    }

    get isConfigured(): boolean {
        return Boolean(this.apiKey && this.apiKey.trim().length > 0);
    }

    get bufferedCount(): number {
        return this.buffer.length;
    }

    getBufferedTraces(): readonly LangWatchTrace[] {
        return [...this.buffer];
    }

    clearBuffer(): void {
        this.buffer.length = 0;
    }

    /**
     * Convert a DataClaw parsed transcript into a structured LangWatch trace.
     */
    fromTranscript(
        transcript: Transcript,
        options: {
            traceId?: string;
            threadId?: string;
            agentId?: string;
            goal?: string;
            stuck?: boolean;
            stuckReasons?: string[];
        } = {},
    ): LangWatchTrace {
        const traceId = options.traceId ?? `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();

        const trace: LangWatchTrace = {
            trace_id: traceId,
            metadata: {
                service_name: this.serviceName,
                environment: this.environment,
                thread_id: options.threadId,
                agent_id: options.agentId ?? "dataclaw",
                goal: options.goal,
                stuck: options.stuck ?? false,
                stuck_reasons: options.stuckReasons ?? [],
                assistant_messages: transcript.assistantMessages,
                stop_reason: transcript.stopReason,
            },
            spans: [],
        };

        // Root user session chain
        const rootSpanId = `span-root-${traceId}`;
        const firstTurn = transcript.turns[0];
        const userPrompt = firstTurn ? firstTurn.text : (options.goal ?? "Data exploration");

        trace.spans.push({
            span_id: rootSpanId,
            type: "chain",
            name: "analyst_session",
            input: { prompt: userPrompt },
            output: transcript.stopReason ? { stopReason: transcript.stopReason } : undefined,
            timestamps: {
                started_at: firstTurn?.timestamp ?? now,
                completed_at: now,
            },
        });

        // Add spans for tool calls
        for (const event of transcript.events) {
            if (event.kind === "toolCall") {
                const duration = event.result?.durationMs ?? 10;
                const startedAt = event.timestamp ?? now;
                const completedAt = startedAt + duration;

                const isAuditorReview = event.toolName === "request_auditor_review";

                trace.spans.push({
                    span_id: `span-${event.callId}`,
                    parent_id: rootSpanId,
                    type: isAuditorReview ? "eval" : "tool",
                    name: event.toolName,
                    input: event.args,
                    output: event.result ? { text: event.result.text } : undefined,
                    metrics: {
                        duration_ms: duration,
                    },
                    timestamps: {
                        started_at: startedAt,
                        completed_at: completedAt,
                    },
                    error: event.result?.isError ? event.result.text : undefined,
                });
            } else if (event.kind === "assistantText" && event.text.trim()) {
                trace.spans.push({
                    span_id: `span-msg-${event.index}`,
                    parent_id: rootSpanId,
                    type: "llm",
                    name: "agent_generation",
                    output: { text: event.text },
                    timestamps: {
                        started_at: event.timestamp ?? now,
                        completed_at: event.timestamp ?? now,
                    },
                });
            }
        }

        // Add guardrail span if stuck state was detected
        if (options.stuck) {
            trace.spans.push({
                span_id: `span-guard-${traceId}`,
                parent_id: rootSpanId,
                type: "guardrail",
                name: "stuck_loop_detector",
                input: { triggered: true, reasons: options.stuckReasons },
                timestamps: { started_at: now, completed_at: now },
                error: `Agent flagged as stuck: ${(options.stuckReasons ?? []).join(", ")}`,
            });
        }

        return trace;
    }

    /**
     * Send or buffer a trace.
     */
    async sendTrace(trace: LangWatchTrace): Promise<SendTraceResult> {
        this.buffer.push(trace);
        // Keep maximum 50 traces in memory buffer
        if (this.buffer.length > 50) this.buffer.shift();

        if (!this.isConfigured) {
            return { ok: true, status: "buffered" };
        }

        try {
            const url = `${this.endpoint}/api/v1/collector`;
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Auth-Token": this.apiKey!,
                },
                body: JSON.stringify(trace),
            });

            if (!response.ok) {
                const text = await response.text();
                return {
                    ok: false,
                    status: response.status,
                    error: `LangWatch HTTP ${response.status}: ${text || response.statusText}`,
                };
            }

            return { ok: true, status: response.status };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                ok: false,
                status: 500,
                error: message || "Failed to reach LangWatch collector",
            };
        }
    }
}

/** Global default LangWatch tracer instance. */
export const defaultLangWatchTracer = new LangWatchTracer();
