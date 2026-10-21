/** One mapping from a transport failure to the closed `SourceError` taxonomy. */
import { isStoppedError } from "../../mcp/http-mcp-client";
import { SourceError, type SourceErrorCode } from "../types";

const EXPIRED = /\b401\b|unauthori[sz]ed|invalid[ _-]?token|token[ _-]?expired|\bexpired\b/i;
const DENIED = /\b403\b|forbidden|permission denied|not authorized|access denied/i;
const TRANSPORT = /failed to connect|could not (?:reach|connect)|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|socket|network|timed out|timeout/i;

export function translateProviderError(
    err: unknown,
    provider: string,
    fallback: SourceErrorCode = "query-error",
): SourceError {
    if (err instanceof SourceError) return err;
    if (isStoppedError(err)) return new SourceError("aborted", "Stopped.", { provider });
    const message = err instanceof Error ? err.message : String(err);
    if (EXPIRED.test(message)) {
        return new SourceError("auth-expired", message, {
            provider,
            hint: "Reconnect the data source to mint a new credential.",
            cause: err,
        });
    }
    if (DENIED.test(message)) {
        return new SourceError("auth-denied", message, {
            provider,
            hint: "Ask the warehouse owner for read access to this schema.",
            cause: err,
        });
    }
    if (TRANSPORT.test(message)) {
        return new SourceError("transport", message, { provider, cause: err });
    }
    return new SourceError(fallback, message, { provider, cause: err });
}
