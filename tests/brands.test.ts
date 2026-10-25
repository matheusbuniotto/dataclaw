import { describe, expect, test } from "bun:test";
import {
    isAgentId,
    isFindingId,
    isHypothesisId,
    isRuleId,
    isProviderId,
    isTableName,
    isMetricName,
    parseAgentId,
    parseFindingId,
    parseHypothesisId,
    parseRuleId,
} from "../src/types/brands";

describe("Domain Branded Types and Verifying Guards", () => {
    test("isAgentId validates slug/identifier format", () => {
        expect(isAgentId("dataclaw")).toBe(true);
        expect(isAgentId("agent_123")).toBe(true);
        expect(isAgentId("specialist-data-sci")).toBe(true);
        expect(isAgentId("")).toBe(false);
        expect(isAgentId(123)).toBe(false);
        expect(isAgentId(null)).toBe(false);
        expect(isAgentId("invalid space")).toBe(false);
    });

    test("isFindingId validates find-N format", () => {
        expect(isFindingId("find-1")).toBe(true);
        expect(isFindingId("find-42")).toBe(true);
        expect(isFindingId("find-0")).toBe(true);
        expect(isFindingId("find-")).toBe(false);
        expect(isFindingId("finding-1")).toBe(false);
        expect(isFindingId("legacy")).toBe(false);
    });

    test("isHypothesisId validates hyp-N format", () => {
        expect(isHypothesisId("hyp-1")).toBe(true);
        expect(isHypothesisId("hyp-100")).toBe(true);
        expect(isHypothesisId("hyp-")).toBe(false);
        expect(isHypothesisId("h-1")).toBe(false);
    });

    test("isRuleId validates rule-vN-M format", () => {
        expect(isRuleId("rule-v1-1")).toBe(true);
        expect(isRuleId("rule-v2-10")).toBe(true);
        expect(isRuleId("rule-1")).toBe(false);
    });

    test("isProviderId and isTableName validate identifiers", () => {
        expect(isProviderId("local")).toBe(true);
        expect(isProviderId("databricks")).toBe(true);
        expect(isProviderId("")).toBe(false);
        expect(isTableName("customers")).toBe(true);
        expect(isTableName("")).toBe(false);
        expect(isMetricName("pearson_correlation")).toBe(true);
    });

    test("boundary parsers narrow valid types and throw on invalid input", () => {
        const agent = parseAgentId("auditor-1");
        expect(String(agent)).toBe("auditor-1");
        expect(() => parseAgentId("")).toThrow(TypeError);

        const finding = parseFindingId("find-99");
        expect(String(finding)).toBe("find-99");
        expect(() => parseFindingId("invalid")).toThrow(TypeError);

        const hyp = parseHypothesisId("hyp-3");
        expect(String(hyp)).toBe("hyp-3");
        expect(() => parseHypothesisId("bad")).toThrow(TypeError);

        const rule = parseRuleId("rule-v1-2");
        expect(String(rule)).toBe("rule-v1-2");
        expect(() => parseRuleId("bad-rule")).toThrow(TypeError);
    });
});
