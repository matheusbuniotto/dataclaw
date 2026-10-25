/**
 * Structured Engine Telemetry & Logger
 *
 * Implements TypeScript Best Practice:
 * - Structured logger diagnostics with enough context to debug from an ID.
 * - No raw console.log in core task/engine execution.
 * - Context objects are strongly typed, avoiding untyped baggage.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
    readonly taskId?: string | number;
    readonly conversationId?: string | number;
    readonly [key: string]: unknown;
}

export interface StructuredLogEntry {
    readonly level: LogLevel;
    readonly subsystem: string;
    readonly message: string;
    readonly timestamp: number;
    readonly context?: LogContext;
}

export type LogHandler = (entry: StructuredLogEntry) => void;

class EngineLogger {
    private handler: LogHandler = (entry) => {
        const prefix = `[${new Date(entry.timestamp).toISOString()}] [${entry.subsystem}]`;
        const taskSuffix = entry.context?.taskId ? ` [task:${entry.context.taskId}]` : "";
        const formatted = `${prefix}${taskSuffix} ${entry.message}`;

        switch (entry.level) {
            case "debug":
                if (process.env.DEBUG || process.env.DATACLAW_DEBUG) {
                    console.debug(formatted, entry.context ?? "");
                }
                break;
            case "info":
                // Standard task output when not quiet
                if (process.env.NODE_ENV !== "test" || process.env.DATACLAW_VERBOSE) {
                    console.info(formatted);
                }
                break;
            case "warn":
                console.warn(formatted, entry.context ?? "");
                break;
            case "error":
                console.error(formatted, entry.context ?? "");
                break;
            default: {
                const _exhaustive: never = entry.level;
                console.log(formatted);
            }
        }
    };

    public setHandler(handler: LogHandler): void {
        this.handler = handler;
    }

    public log(level: LogLevel, subsystem: string, message: string, context?: LogContext): void {
        this.handler({
            level,
            subsystem,
            message,
            timestamp: Date.now(),
            ...(context ? { context } : {}),
        });
    }

    public debug(subsystem: string, message: string, context?: LogContext): void {
        this.log("debug", subsystem, message, context);
    }

    public info(subsystem: string, message: string, context?: LogContext): void {
        this.log("info", subsystem, message, context);
    }

    public warn(subsystem: string, message: string, context?: LogContext): void {
        this.log("warn", subsystem, message, context);
    }

    public error(subsystem: string, message: string, context?: LogContext): void {
        this.log("error", subsystem, message, context);
    }

    public child(subsystem: string, baseContext: LogContext) {
        return {
            debug: (message: string, context?: LogContext) =>
                this.debug(subsystem, message, { ...baseContext, ...context }),
            info: (message: string, context?: LogContext) =>
                this.info(subsystem, message, { ...baseContext, ...context }),
            warn: (message: string, context?: LogContext) =>
                this.warn(subsystem, message, { ...baseContext, ...context }),
            error: (message: string, context?: LogContext) =>
                this.error(subsystem, message, { ...baseContext, ...context }),
        };
    }
}

export const engineLogger = new EngineLogger();
