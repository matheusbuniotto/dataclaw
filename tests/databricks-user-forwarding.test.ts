import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
    captureForwardedUser,
    deriveDisplayName,
    deriveInitials,
    getActiveForwardedToken,
    getActiveForwardedUser,
    getDatabricksUiStatus,
    resetForwardedUser,
} from "../src/backend/api/databricks-api";
import { handle } from "../src/backend/api/routes";

describe("Databricks user identity and auth forwarding", () => {
    beforeEach(() => {
        resetForwardedUser();
    });

    afterAll(() => {
        resetForwardedUser();
    });
    describe("deriveDisplayName", () => {
        it("extracts and formats full name from email address", () => {
            expect(deriveDisplayName("matheus.buniotto@gmail.com")).toBe("Matheus Buniotto");
            expect(deriveDisplayName("jane_doe@company.org")).toBe("Jane Doe");
            expect(deriveDisplayName("alex-smith@domain.com")).toBe("Alex Smith");
        });

        it("preserves explicit full names", () => {
            expect(deriveDisplayName("Matheus Buniotto")).toBe("Matheus Buniotto");
            expect(deriveDisplayName("Ada Lovelace")).toBe("Ada Lovelace");
        });

        it("formats dotted or underscored usernames", () => {
            expect(deriveDisplayName("alan.turing")).toBe("Alan Turing");
            expect(deriveDisplayName("grace_hopper")).toBe("Grace Hopper");
        });

        it("handles undefined and empty input", () => {
            expect(deriveDisplayName(undefined)).toBeUndefined();
            expect(deriveDisplayName("")).toBeUndefined();
            expect(deriveDisplayName("   ")).toBeUndefined();
        });
    });

    describe("deriveInitials", () => {
        it("extracts 2-letter uppercase initials from full names", () => {
            expect(deriveInitials("Matheus Buniotto")).toBe("MB");
            expect(deriveInitials("Ada Lovelace")).toBe("AL");
            expect(deriveInitials("Jean-Luc Picard")).toBe("JP");
        });

        it("extracts initials from email addresses", () => {
            expect(deriveInitials("matheus.buniotto@gmail.com")).toBe("MB");
            expect(deriveInitials("alice.wonderland@databricks.com")).toBe("AW");
        });

        it("extracts 2 letters from single names or falls back cleanly", () => {
            expect(deriveInitials("Antigravity")).toBe("AN");
            expect(deriveInitials("A")).toBe("A");
            expect(deriveInitials(undefined)).toBe("DC");
        });
    });

    describe("captureForwardedUser", () => {
        it("captures user display name, email, initials and token from Databricks Apps proxy headers", () => {
            const req = new Request("http://localhost:3000/api/databricks/status", {
                headers: {
                    "X-Forwarded-Preferred-Username": "Matheus Buniotto",
                    "X-Forwarded-Email": "matheus.buniotto@gmail.com",
                    "X-Forwarded-User": "matheus.buniotto@gmail.com",
                    "X-Forwarded-Access-Token": "dapi-test-token-12345",
                },
            });

            const context = captureForwardedUser(req);
            expect(context).toBeDefined();
            expect(context?.user).toBe("matheus.buniotto@gmail.com");
            expect(context?.userName).toBe("Matheus Buniotto");
            expect(context?.userEmail).toBe("matheus.buniotto@gmail.com");
            expect(context?.userInitials).toBe("MB");
            expect(context?.userToken).toBe("dapi-test-token-12345");

            expect(getActiveForwardedUser()?.user).toBe("matheus.buniotto@gmail.com");
            expect(getActiveForwardedToken()).toBe("dapi-test-token-12345");
        });

        it("derives name and initials when only email is provided in headers", () => {
            const req = new Request("http://localhost:3000/api/workspace", {
                headers: {
                    "X-Forwarded-Email": "jane.data@databricksapps.com",
                },
            });

            const context = captureForwardedUser(req);
            expect(context?.userName).toBe("Jane Data");
            expect(context?.userEmail).toBe("jane.data@databricksapps.com");
            expect(context?.userInitials).toBe("JD");
        });
    });

    describe("HTTP routes with forwarded Databricks headers", () => {
        it("GET /api/databricks/status returns forwarded user and auth info", async () => {
            const req = new Request("http://localhost:3000/api/databricks/status", {
                headers: {
                    "X-Forwarded-Preferred-Username": "Matheus Buniotto",
                    "X-Forwarded-Email": "matheus.buniotto@gmail.com",
                    "X-Forwarded-Access-Token": "test-obo-token",
                },
            });

            const res = await handle(req);
            expect(res.status).toBe(200);
            const body = await res.json() as Record<string, unknown>;
            expect(body.ok).toBe(true);
            expect(body.userName).toBe("Matheus Buniotto");
            expect(body.userEmail).toBe("matheus.buniotto@gmail.com");
            expect(body.userInitials).toBe("MB");
            expect(body.hasUserToken).toBe(true);
        });

        it("GET /api/auth/me returns current user identity snapshot", async () => {
            const req = new Request("http://localhost:3000/api/auth/me", {
                headers: {
                    "X-Forwarded-Preferred-Username": "Elena Rostova",
                    "X-Forwarded-Email": "elena@company.com",
                    "X-Forwarded-Access-Token": "test-elena-token",
                },
            });

            const res = await handle(req);
            expect(res.status).toBe(200);
            const body = await res.json() as Record<string, unknown>;
            expect(body.ok).toBe(true);
            expect(body.name).toBe("Elena Rostova");
            expect(body.email).toBe("elena@company.com");
            expect(body.initials).toBe("ER");
            expect(body.hasUserToken).toBe(true);
        });
    });
});
