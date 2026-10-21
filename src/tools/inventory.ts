/**
 * The tool inventory: one declaration per built-in tool.
 *
 * Five readers derive from this table instead of keeping their own copy of the names — the
 * capability groups (`docs/agent-capabilities.ts`), the console catalog
 * (`capabilities/catalog.ts`), the chat card's phrase and category
 * (`prototype/ChatComponents.tsx`), the run summary and its source chips
 * (`prototype/workspace.ts`), and the read-only SQL guard in `extensions/analyst-extension.ts`.
 *
 * Plugin tools are deliberately absent: they are addressed by `plugin:<name>` and come from the
 * live registry, so an installed plugin appears in every reader without an edit here.
 *
 * The module imports nothing, so the console bundle can read it. Its declarations must equal
 * what `durable-analyst` registers plus what `coding-tools` publishes;
 * `tests/tool-inventory.test.ts` asserts both halves.
 */

/** Capability groups that own a fixed set of tools. `all` and `plugins` resolve from the registry. */
export type ToolCapabilityGroup = "analyst" | "databricks" | "coding" | "roster" | "features";

/** Icon and colour one chat call gets. */
export type ToolCategory = "db" | "terminal" | "file" | "audit" | "other";

export interface ToolPhrase {
    /** Shown while the call runs. */
    readonly calling: string;
    /** Shown once it has finished. */
    readonly called: string;
}

/** How one call's arguments become the transcript's one-line summary. */
export interface ToolSummary {
    /** Argument keys, tried in order; only non-empty strings count. */
    readonly keys: readonly string[];
    /** `line` cuts to the first line, `path` to the file name. */
    readonly shape?: "line" | "path";
    /** Separator when more than one key has a value. Default " ". */
    readonly join?: string;
    /** Text before the rendered value, such as "Audit ". */
    readonly prefix?: string;
    /** Shown when no key has a value. Default: the tool name. */
    readonly fallback?: string;
}

/** An argument that names a source the call touched. */
export interface ToolSource {
    readonly key: string;
    /** `path` contributes the file name instead of the whole path. */
    readonly shape?: "path";
}

export interface ToolDeclaration {
    /** The capability group that installs this tool. */
    readonly group: ToolCapabilityGroup;
    /** Chat card category; defaults to the group's own. */
    readonly category?: ToolCategory;
    /** Chat phrasing; a tool without one gets the generic "Calling <name>" phrase. */
    readonly phrase?: ToolPhrase;
    /** The call sends SQL to the data source, so the analyst extension checks that it is read-only. */
    readonly runsSql?: boolean;
    readonly summary?: ToolSummary;
    readonly sources?: readonly ToolSource[];
}

/** Default chat category per group: the tools of a group share a look unless one says otherwise. */
const CATEGORY_BY_GROUP: Record<ToolCapabilityGroup, ToolCategory> = {
    databricks: "db",
    analyst: "audit",
    coding: "file",
    roster: "other",
    features: "other",
};

export const TOOL_DECLARATIONS = {
    // The source-neutral data tools. They work against whichever data source is connected.
    list_data_sources: {
        group: "databricks",
        phrase: { calling: "Listing data sources", called: "Listed data sources" },
    },
    connect_data_source: {
        group: "databricks",
        phrase: { calling: "Connecting to a data source", called: "Connected to a data source" },
        summary: { keys: ["provider"], fallback: "data source" },
        sources: [{ key: "provider" }],
    },
    discover_data: {
        group: "databricks",
        phrase: { calling: "Exploring the data source", called: "Explored the data source" },
        summary: { keys: ["step", "namespace", "dataset"], join: " · ", fallback: "children" },
    },
    profile_table: {
        group: "databricks",
        phrase: { calling: "Profiling table", called: "Profiled table" },
        summary: { keys: ["table"] },
    },
    query_data: {
        group: "databricks",
        phrase: { calling: "Querying the data source", called: "Queried the data source" },
        runsSql: true,
        summary: { keys: ["sql"], shape: "line" },
    },
    calculate_metric: {
        group: "databricks",
        phrase: { calling: "Calculating metric", called: "Calculated metric" },
    },

    // The rest of the analyst extension: datasets, hypotheses, findings, playbook, audit.
    load_dataset: {
        group: "analyst",
        category: "file",
        phrase: { calling: "Loading dataset", called: "Loaded dataset" },
        summary: { keys: ["filePath"], shape: "path" },
        sources: [{ key: "filePath", shape: "path" }],
    },
    manage_hypotheses: {
        group: "analyst",
        phrase: { calling: "Updating hypotheses", called: "Updated hypotheses" },
        summary: { keys: ["action"] },
    },
    record_finding: {
        group: "analyst",
        phrase: { calling: "Recording finding", called: "Recorded finding" },
        summary: { keys: ["title"] },
    },
    consult_playbook: {
        group: "analyst",
        phrase: { calling: "Consulting playbook", called: "Consulted playbook" },
    },
    request_auditor_review: {
        group: "analyst",
        phrase: { calling: "Requesting audit", called: "Requested audit" },
        summary: { keys: ["findingId"], prefix: "Audit " },
    },
    record_reflection: {
        group: "analyst",
        category: "other",
        phrase: { calling: "Recording reflection", called: "Recorded reflection" },
    },
    record_human_feedback: {
        group: "analyst",
        category: "other",
        phrase: { calling: "Recording feedback", called: "Recorded feedback" },
    },
    promote_playbook_rule: {
        group: "analyst",
        phrase: { calling: "Promoting playbook rule", called: "Promoted playbook rule" },
    },
    trigger_auto_improvement: {
        group: "analyst",
        category: "other",
        phrase: { calling: "Improving playbook", called: "Improved playbook" },
    },

    // File and shell tools, published by the `coding-tools` extension.
    read: {
        group: "coding",
        phrase: { calling: "Reading file", called: "Read file" },
        summary: { keys: ["path"], shape: "path" },
    },
    write: {
        group: "coding",
        phrase: { calling: "Writing file", called: "Wrote file" },
        summary: { keys: ["path"], shape: "path" },
    },
    edit: {
        group: "coding",
        phrase: { calling: "Editing file", called: "Edited file" },
        summary: { keys: ["path"], shape: "path" },
    },
    bash: {
        group: "coding",
        category: "terminal",
        phrase: { calling: "Running command", called: "Ran command" },
        summary: { keys: ["command"], shape: "line" },
    },

    // Roster management and delegation; a spawned run never gets these.
    agents_list: {
        group: "roster",
        phrase: { calling: "Listing agents", called: "Listed agents" },
    },
    agents_inspect: { group: "roster" },
    agents_create: {
        group: "roster",
        phrase: { calling: "Creating agent", called: "Created agent" },
    },
    agents_update: {
        group: "roster",
        phrase: { calling: "Updating agent", called: "Updated agent" },
    },
    agents_archive: {
        group: "roster",
        phrase: { calling: "Archiving agent", called: "Archived agent" },
    },
    spawn_agent: {
        group: "roster",
        phrase: { calling: "Delegating to agent", called: "Delegated to agent" },
    },
    subagents_list: {
        group: "roster",
        phrase: { calling: "Listing delegated runs", called: "Listed delegated runs" },
    },

    // The meta-agent's self-extension tools; a spawned run never gets these.
    features_list: { group: "features" },
    features_create_skill: { group: "features" },
    features_remove_skill: { group: "features" },
    features_create_plugin: { group: "features" },
    features_remove_plugin: { group: "features" },
    features_apply: { group: "features" },
} as const satisfies Record<string, ToolDeclaration>;

export type ToolName = keyof typeof TOOL_DECLARATIONS;

/**
 * What a tool declares, looked up by name. Plugin tools and anything else that is not
 * declared returns `undefined`; every reader treats that as "use the generic behaviour".
 */
export function toolDeclaration(name: string): ToolDeclaration | undefined {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(TOOL_DECLARATIONS, key)
        ? TOOL_DECLARATIONS[key as ToolName]
        : undefined;
}

/** The declared tools of one group, in declaration order. */
export function declaredTools(group: ToolCapabilityGroup): ToolName[] {
    return (Object.keys(TOOL_DECLARATIONS) as ToolName[])
        .filter((name) => TOOL_DECLARATIONS[name].group === group);
}

/** The chat category for a tool: its own, its group's default, or `other` when undeclared. */
export function declaredCategory(name: string): ToolCategory {
    const declaration = toolDeclaration(name);
    return declaration ? declaration.category ?? CATEGORY_BY_GROUP[declaration.group] : "other";
}
