/**
 * Domain Branded Types for DataClaw
 *
 * Implements strict type-system discipline:
 * - Brand primitives with `& { readonly __brand: "X" }` so they cannot be mixed up.
 * - Brands come from verifying type guards (`isAgentId`), never from unchecked `as`.
 * - Parse helpers validate boundary input and throw descriptive errors when invalid.
 */

export type Brand<K, T extends string> = K & { readonly __brand: T };

export type AgentId = Brand<string, "AgentId">;
export type FindingId = Brand<string, "FindingId">;
export type HypothesisId = Brand<string, "HypothesisId">;
export type RuleId = Brand<string, "RuleId">;
export type ProviderId = Brand<string, "ProviderId">;
export type TableName = Brand<string, "TableName">;
export type MetricName = Brand<string, "MetricName">;

/** Verifying type guard for AgentId */
export function isAgentId(value: unknown): value is AgentId {
    return typeof value === "string" && value.length > 0 && /^[a-z0-9_-]+$/i.test(value);
}

/** Verifying type guard for FindingId */
export function isFindingId(value: unknown): value is FindingId {
    return typeof value === "string" && /^find-\d+$/i.test(value);
}

/** Verifying type guard for HypothesisId */
export function isHypothesisId(value: unknown): value is HypothesisId {
    return typeof value === "string" && /^hyp-\d+$/i.test(value);
}

/** Verifying type guard for RuleId */
export function isRuleId(value: unknown): value is RuleId {
    return typeof value === "string" && /^rule-v\d+-\d+$/i.test(value);
}

/** Verifying type guard for ProviderId */
export function isProviderId(value: unknown): value is ProviderId {
    return typeof value === "string" && value.length > 0 && /^[a-z0-9_-]+$/i.test(value);
}

/** Verifying type guard for TableName */
export function isTableName(value: unknown): value is TableName {
    return typeof value === "string" && value.trim().length > 0;
}

/** Verifying type guard for MetricName */
export function isMetricName(value: unknown): value is MetricName {
    return typeof value === "string" && value.trim().length > 0;
}

/** Boundary validation: parse an AgentId from unknown data */
export function parseAgentId(value: unknown): AgentId {
    if (!isAgentId(value)) {
        throw new TypeError(`Invalid AgentId: expected alphanumeric/hyphen string, received "${String(value)}"`);
    }
    return value;
}

/** Boundary validation: parse a FindingId from unknown data */
export function parseFindingId(value: unknown): FindingId {
    if (!isFindingId(value)) {
        throw new TypeError(`Invalid FindingId: expected "find-N" format, received "${String(value)}"`);
    }
    return value;
}

/** Boundary validation: parse a HypothesisId from unknown data */
export function parseHypothesisId(value: unknown): HypothesisId {
    if (!isHypothesisId(value)) {
        throw new TypeError(`Invalid HypothesisId: expected "hyp-N" format, received "${String(value)}"`);
    }
    return value;
}

/** Boundary validation: parse a RuleId from unknown data */
export function parseRuleId(value: unknown): RuleId {
    if (!isRuleId(value)) {
        throw new TypeError(`Invalid RuleId: expected "rule-vN-M" format, received "${String(value)}"`);
    }
    return value;
}
