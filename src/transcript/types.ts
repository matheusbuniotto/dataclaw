/** One persisted tool result, after the parse has decided whether it answers a call. */
export interface TranscriptToolResult {
    /** `toolCallId` of the message; "" when the message carried none. */
    callId: string;
    toolName?: string;
    /** Text blocks of the result, trimmed and newline-joined; "" when it had none. */
    text: string;
    isError: boolean;
    durationMs?: number;
}

/**
 * One typed event of a persisted conversation. This is the single parse product: the console's
 * run list and chat view, and the eval trace, all read these events instead of the raw messages.
 */
export type TranscriptEvent =
    /** A user message. It opens a turn, so this is the turn boundary. */
    | { kind: "turnStart"; index: number; timestamp?: number; text: string }
    | { kind: "assistantText"; index: number; timestamp?: number; text: string }
    | { kind: "assistantThinking"; index: number; timestamp?: number; text: string }
    /** A tool call. `result` stays undefined when no result arrived: the call is still an event. */
    | {
        kind: "toolCall";
        index: number;
        timestamp?: number;
        /** The call's id, or a stable synthetic id when the message omitted one. */
        callId: string;
        toolName: string;
        args: unknown;
        result?: TranscriptToolResult;
    }
    /** A result whose call is not in the transcript, e.g. history truncated before the call. */
    | { kind: "toolResult"; index: number; timestamp?: number; result: TranscriptToolResult }
    | { kind: "stop"; index: number; timestamp?: number; stopReason: string; errorMessage?: string };

/** One user turn: the message that opened it plus every event that followed it. */
export interface TranscriptTurn {
    /** 0-based position of the turn in the conversation. */
    turn: number;
    /** Index of the user message that opened the turn. */
    index: number;
    timestamp?: number;
    /** The user's message text; "" when the message carried no text. */
    text: string;
    /** The turn boundary event and everything up to the next user message. */
    events: TranscriptEvent[];
}

/** A conversation parsed once. `readWorkspace` reads both turns and items from one of these. */
export interface Transcript {
    /** Discriminant for consumers that accept messages or an already-parsed transcript. */
    readonly kind: "transcript";
    /** Every event in message order; `turnStart` marks a turn boundary. */
    events: TranscriptEvent[];
    /**
     * One entry per user message. Only a user message opens a turn, so events that precede the
     * first user message are in `events` but in no turn: the chat view and the trace show them,
     * the run list has no turn to attach them to.
     */
    turns: TranscriptTurn[];
    /** Assistant messages seen, including ones that carried no content. */
    assistantMessages: number;
    /** Stop reason of the last assistant message that carried one: "stop", "toolUse", "aborted", "error", ... */
    stopReason?: string;
    /** Provider error on the last assistant message, when it stopped with "error". */
    errorMessage?: string;
}
