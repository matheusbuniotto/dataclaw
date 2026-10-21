/**
 * The failure taxonomy the session and every provider share. Pinning the retryable set here keeps a
 * caller from retrying a denied credential or a refused mutation.
 */
import { describe, expect, test } from "bun:test";
import { SourceError, type SourceErrorCode } from "../src/datasource/types";

const CODES: SourceErrorCode[] = [
    "no-session",
    "not-configured",
    "auth-expired",
    "auth-denied",
    "read-only-unavailable",
    "unsupported-capability",
    "dialect-missing",
    "query-error",
    "transport",
    "aborted",
];

describe("SourceError", () => {
    test("is a real Error that keeps its code and provider", () => {
        const error = new SourceError("auth-denied", "the token cannot read this catalog", {
            provider: "databricks",
        });
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("SourceError");
        expect(error.code).toBe("auth-denied");
        expect(error.provider).toBe("databricks");
    });

    test("only failures a retry can fix are retryable", () => {
        const retryable = CODES.filter((code) => new SourceError(code, "x").retryable);
        expect(retryable).toEqual(["auth-expired", "transport", "aborted"]);
    });

    test("carries the server's tools and a hint for the model", () => {
        const error = new SourceError("unsupported-capability", "the server has no describe tool", {
            hint: "add dataSource.tools.describe, or use a dialect that generates it",
            available: ["run_sql", "list_objects"],
        });
        expect(error.available).toEqual(["run_sql", "list_objects"]);
        expect(error.hint).toContain("dataSource.tools.describe");
    });

    test("keeps the original failure as the cause", () => {
        const cause = new Error("ECONNRESET");
        const error = new SourceError("transport", "could not reach the warehouse", { cause });
        expect(error.cause).toBe(cause);
    });
});
