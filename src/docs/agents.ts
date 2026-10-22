import { defineDoc } from "@earendil-works/pi-durable";
import {
    capabilitiesCanManage,
    DEFAULT_SPECIALIST_CAPABILITIES,
    defaultCapabilitiesForRole,
    formatCapabilities,
} from "./agent-capabilities";
import {
    formatCompute,
    normalizedCompute,
    parseAgentCompute,
    type AgentCompute,
} from "../compute/agent-compute";

/** Active specialists the coordinator may keep. Archived agents do not count. */
export const MAX_ROSTER_AGENTS = 24;
/** Delegated runs kept on the roster. Older finished runs drop first. */
export const MAX_ROSTER_RUNS = 40;

export type AgentRoleTemplate = {
    title: string;
    purpose: string;
    canManage: boolean;
    /** Capabilities a freshly created agent of this role starts with. */
    capabilities: readonly string[];
    instructions: string;
};

export const AGENT_ROLES = {
    coordinator: {
        title: "Coordinator",
        purpose: "Single point of contact. Create specialists and delegate work.",
        canManage: true,
        capabilities: ["all"],
        instructions: [
            "You are a coordinator for DataClaw, the user's point of contact for a team of specialists.",
            "Create and update agents with the agents_* tools. Delegate with spawn_agent.",
            "Give each specialist only the capabilities and compute its work needs. Prefer the smallest set; use docker compute for untrusted code.",
            "Use mode run when the user wants the answer in this chat. Use mode session when they want that agent's own ongoing conversation.",
            "Do small tasks yourself. Delegate research, drafting, and review when the user asks for a separate agent.",
            "Record durable findings on this conversation after a specialist returns evidence.",
        ].join("\n"),
    },
    data_scientist: {
        title: "Data Scientist",
        purpose: "Exploratory data analysis, statistical hypotheses, modeling, and predictive metrics.",
        canManage: false,
        capabilities: ["analyst", "data", "coding", "plugins"],
        instructions: [
            "You are a Data Scientist for DataClaw. Conduct rigorous exploratory data analysis, hypothesis testing, and statistical evaluations.",
            "Formulate testable hypotheses, examine distributions, detect anomalies and confounders (such as Simpson's Paradox or cohort biases), and write Python or SQL scripts in your workspace to model patterns.",
            "Validate assumptions against observed data before drawing causal or predictive conclusions. Provide reproducible code and clear analytical summaries.",
            "Do not invent datasets or numbers. Return your findings with evidence and code artifacts to the coordinator.",
        ].join("\n"),
    },
    mlops: {
        title: "MLOps Engineer",
        purpose: "Model lifecycle monitoring, containerized pipelines, data drift detection, and automated validation.",
        canManage: false,
        capabilities: ["analyst", "data", "coding", "plugins"],
        instructions: [
            "You are an MLOps Engineer for DataClaw. Oversee model operations, pipeline reliability, data drift monitoring, and containerized runtime environments.",
            "Validate input schemas, monitor performance metrics and inference latencies, verify artifact versioning, and automate evaluation pipelines.",
            "Use bash and file tools in your isolated compute environment to inspect models, check container configurations, and ensure reproducible deployments.",
            "Report pipeline health, drift indicators, and operational recommendations to the coordinator.",
        ].join("\n"),
    },
    data_engineer: {
        title: "Data Engineer",
        purpose: "Catalog discovery, schema transformations, ETL/ELT pipelines, and data quality assurance.",
        canManage: false,
        capabilities: ["analyst", "data", "coding", "plugins"],
        instructions: [
            "You are a Data Engineer for DataClaw. Discover catalog schemas, design robust transformation pipelines, and guarantee data quality.",
            "Inspect relational, tabular, and event streams (CSV, TSV, JSON, NDJSON, Parquet, SQL tables), write optimized transformation queries, and check primary key constraints and nullability.",
            "Ensure data pipeline resilience and document data lineage clearly for the team.",
        ].join("\n"),
    },
    analytics_engineer: {
        title: "Analytics Engineer",
        purpose: "Semantic layer modeling, dimensional metrics, cohort analysis, and executive dashboards.",
        canManage: false,
        capabilities: ["analyst", "data", "coding", "plugins"],
        instructions: [
            "You are an Analytics Engineer for DataClaw. Build clean semantic models, standard dimensional schemas, and trustworthy business metrics.",
            "Define unambiguous KPI measures (retention cohorts, ARR/MRR, conversion rates, customer lifetime value) and translate raw database tables into clean analytical marts.",
            "Validate metric consistency across dimensions and generate executive-ready intelligence.",
        ].join("\n"),
    },
    researcher: {
        title: "Researcher",
        purpose: "Gather evidence and return a cited brief.",
        canManage: false,
        capabilities: ["analyst", "databricks", "coding", "plugins"],
        instructions: [
            "You are a researcher for DataClaw. Gather evidence and return a cited brief.",
            "Explore before you claim. Profile and query local files or Databricks, and use read for workspace files.",
            "Do not invent catalogs, tables, columns, or statistics.",
            "Do not create agents, spawn subagents, or change the playbook. Return the brief to the coordinator.",
        ].join("\n"),
    },
    writer: {
        title: "Writer",
        purpose: "Turn a brief and source material into a usable draft.",
        canManage: false,
        capabilities: ["analyst", "databricks", "coding", "plugins"],
        instructions: [
            "You are a writer for DataClaw. Turn the task's brief and source material into a usable draft.",
            "Do not invent measurements. If a number is not in the task or a file you read, say it is missing.",
            "Do not create agents or spawn subagents.",
        ].join("\n"),
    },
    reviewer: {
        title: "Reviewer",
        purpose: "Check a claim against the evidence and return actionable findings.",
        canManage: false,
        capabilities: ["analyst", "databricks", "coding", "plugins"],
        instructions: [
            "You are a reviewer for DataClaw. Check the task's claim against evidence and return actionable findings.",
            "Name what holds, what is weak, and what to measure next.",
            "When data access is available, re-run the evidence query before you agree with the claim.",
            "Do not create agents or spawn subagents.",
        ].join("\n"),
    },
} as const satisfies Record<string, AgentRoleTemplate>;

export type AgentRoleName = keyof typeof AGENT_ROLES;

export type RosterAgent = {
    id: string;
    name: string;
    role: string;
    purpose: string;
    /** Persona and operating rules. The profile background and knowledge files are added at prompt time. */
    instructions: string;
    status: "active" | "archived";
    canManage: boolean;
    /** Capability names: groups (`analyst`, `databricks`, `coding`, `plugins`, `roster`, `features`, `all`),
     * `plugin:<name>`, or explicit tool names. Resolved against the live registry per turn. */
    capabilities: string[];
    /** Workspace- or project-relative files whose content is injected into this agent's prompt. */
    contextFiles: string[];
    /** Inline knowledge, for context that does not deserve a file. */
    background: string;
    /** Skill names to keep; empty means every available skill. */
    skills: string[];
    /** Optional model override. Unset means inherit the coordinator's model. */
    model?: { provider: string; modelId: string };
    /** Where this agent's files and shell live. Old agents default to the shared workspace. */
    compute: AgentCompute;
    /** Ownerless conversation that holds this agent's own session. */
    conversationId: number;
    /** Tool task that created the agent, so a replay does not create a second one. */
    createdByTask: string;
    createdAt: number;
    updatedAt: number;
};

export type AgentRun = {
    id: string;
    agentId: string;
    agentName: string;
    label: string;
    mode: "run" | "session";
    conversationId: number;
    status: "running" | "finished" | "failed";
    summary: string;
    startedAt: number;
    finishedAt: number;
};

export type AgentRosterDocument = {
    agents: RosterAgent[];
    runs: AgentRun[];
};

export type AgentBindingDocument = {
    /** Empty on the root coordinator. A roster id on a specialist session. */
    agentId: string;
    /** `run` is a one-shot delegation and cannot manage the roster. */
    origin: "roster" | "run";
};

export const AgentRosterDoc = defineDoc<AgentRosterDocument>({
    kind: "analyst.agent_roster",
    version: 3,
    scope: "session",
    initial: () => ({ agents: [], runs: [] }),
    migrate: (value, fromVersion) => {
        if (fromVersion < 2) {
            const roster = value as unknown as AgentRosterDocument;
            for (const agent of roster.agents ?? []) {
                agent.capabilities ??= [...defaultCapabilitiesForRole(agent.role)];
                agent.contextFiles ??= [];
                agent.background ??= "";
                agent.skills ??= [];
            }
        }
        if (fromVersion < 3) {
            const roster = value as unknown as AgentRosterDocument;
            for (const agent of roster.agents ?? []) {
                // Existing agents ran in the workspace root. Keep that until the user asks for isolation.
                agent.compute ??= { kind: "shared" };
            }
        }
        return value as AgentRosterDocument;
    },
});

export const AgentBindingDoc = defineDoc<AgentBindingDocument>({
    kind: "analyst.agent_binding",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ agentId: "", origin: "roster" }),
});

export interface AgentDraftInput {
    name: string;
    role: string;
    instructions?: string | undefined;
    purpose?: string | undefined;
    capabilities?: readonly string[] | undefined;
    contextFiles?: readonly string[] | undefined;
    background?: string | undefined;
    skills?: readonly string[] | undefined;
    model?: string | undefined;
    compute?: unknown;
}

export interface AgentPatch {
    name?: string | undefined;
    role?: string | undefined;
    instructions?: string | undefined;
    purpose?: string | undefined;
    status?: string | undefined;
    capabilities?: readonly string[] | undefined;
    contextFiles?: readonly string[] | undefined;
    background?: string | undefined;
    skills?: readonly string[] | undefined;
    /** `provider/modelId`, or an empty string to inherit the coordinator's model again. */
    model?: string | undefined;
    compute?: unknown;
}

export type AgentChangeResult =
    | { ok: true; agent: RosterAgent; instructionsChanged: boolean }
    | { ok: false; error: string };

const ROLE_NAMES = Object.keys(AGENT_ROLES);

export function slugifyAgentName(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return slug || "agent";
}

export function allocateAgentId(taken: Iterable<string>, name: string): string {
    const used = new Set<string>(["dataclaw", "main", ...taken]);
    const base = slugifyAgentName(name);
    if (!used.has(base)) return base;
    for (let n = 2; n < 100; n++) {
        const candidate = `${base}-${n}`.slice(0, 48);
        if (!used.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export function managementRefusal(
    binding: { agentId: string; origin: string },
    roster: { agents: readonly { id: string; status: string; canManage: boolean }[] },
): string | undefined {
    if (binding.origin === "run") {
        return "A spawned run cannot create or delegate agents. Finish the task and return the result to the coordinator.";
    }
    if (!binding.agentId) return undefined;
    const self = roster.agents.find((agent) => agent.id === binding.agentId);
    if (self && (self.status !== "active" || !self.canManage)) {
        return "This agent cannot manage other agents. Return the result to the coordinator.";
    }
    return undefined;
}

export function prepareAgent(
    roster: AgentRosterDocument,
    input: AgentDraftInput,
    now: number,
): { ok: true; agent: RosterAgent } | { ok: false; error: string } {
    const name = cleanName(input.name);
    if (!name.ok) return name;

    const duplicate = roster.agents.find((agent) => agent.name.toLowerCase() === name.value.toLowerCase());
    if (duplicate?.status === "archived") {
        return {
            ok: false,
            error: `"${duplicate.name}" (${duplicate.id}) is archived. Restore it with agents_update status "active".`,
        };
    }
    if (duplicate) {
        return { ok: false, error: `An agent named "${duplicate.name}" already exists (${duplicate.id}).` };
    }

    const active = roster.agents.filter((agent) => agent.status === "active").length;
    if (active >= MAX_ROSTER_AGENTS) {
        return {
            ok: false,
            error: `The roster already has ${MAX_ROSTER_AGENTS} active agents. Archive one before creating another.`,
        };
    }

    const resolved = resolveRole(input.role, input.instructions, input.purpose);
    if (!resolved.ok) return resolved;

    const capabilities = normalizeCapabilities(input.capabilities, resolved.roleCapabilities);
    if (!capabilities.ok) return capabilities;
    const contextFiles = normalizeContextFiles(input.contextFiles);
    if (!contextFiles.ok) return contextFiles;
    const background = cleanBackground(input.background);
    if (!background.ok) return background;
    const skills = normalizeSkills(input.skills);
    if (!skills.ok) return skills;
    const model = parseModel(input.model);
    if (!model.ok) return model;
    const compute = parseAgentCompute(input.compute);
    if (!compute.ok) return compute;

    return {
        ok: true,
        agent: {
            id: allocateAgentId(roster.agents.map((agent) => agent.id), name.value),
            name: name.value,
            role: resolved.role,
            purpose: resolved.purpose,
            instructions: resolved.instructions,
            status: "active",
            canManage: roleAllowsManagement(resolved.role) && capabilitiesCanManage(capabilities.value),
            capabilities: capabilities.value,
            contextFiles: contextFiles.value,
            background: background.value,
            skills: skills.value,
            ...(model.value ? { model: model.value } : {}),
            compute: compute.value,
            conversationId: 0,
            createdByTask: "",
            createdAt: now,
            updatedAt: now,
        },
    };
}

export function applyAgentUpdate(
    roster: AgentRosterDocument,
    agentId: string,
    patch: AgentPatch,
    now: number,
): AgentChangeResult {
    const agent = roster.agents.find((item) => item.id === agentId);
    if (!agent) return { ok: false, error: `No agent with id "${agentId}". Use agents_list.` };

    const hasPatch = patch.name !== undefined
        || patch.role !== undefined
        || patch.instructions !== undefined
        || patch.purpose !== undefined
        || patch.status !== undefined
        || patch.capabilities !== undefined
        || patch.contextFiles !== undefined
        || patch.background !== undefined
        || patch.skills !== undefined
        || patch.model !== undefined
        || patch.compute !== undefined;
    if (!hasPatch) return { ok: false, error: "Nothing to update. Pass a name, role, instructions, purpose, capabilities, contextFiles, background, skills, model, compute, or status." };

    if (patch.name !== undefined) {
        const name = cleanName(patch.name);
        if (!name.ok) return name;
        const duplicate = roster.agents.find((item) =>
            item.id !== agent.id && item.name.toLowerCase() === name.value.toLowerCase()
        );
        if (duplicate) return { ok: false, error: `"${duplicate.name}" is already used by ${duplicate.id}.` };
        agent.name = name.value;
    }

    const couldManage = agent.canManage;
    let instructionsChanged = patch.instructions !== undefined;
    let managementAllowed = roleAllowsManagement(agent.role);
    let capabilities = agent.capabilities ?? defaultCapabilitiesForRole(agent.role);
    let resetCapabilities = false;
    if (patch.role !== undefined) {
        const switching = patch.role.trim().toLowerCase() !== agent.role;
        const resolved = resolveRole(
            patch.role,
            patch.instructions !== undefined ? patch.instructions : (switching ? undefined : agent.instructions),
            patch.purpose ?? agent.purpose,
        );
        if (!resolved.ok) return resolved;
        instructionsChanged = instructionsChanged || resolved.instructions !== agent.instructions;
        agent.role = resolved.role;
        agent.instructions = resolved.instructions;
        managementAllowed = roleAllowsManagement(resolved.role);
        resetCapabilities = switching;
        if (switching) capabilities = [...resolved.roleCapabilities];
    } else if (patch.instructions !== undefined) {
        const text = patch.instructions.trim();
        if (text.length < 12) return { ok: false, error: "Instructions need at least a sentence." };
        if (text.length > 6_000) return { ok: false, error: "Instructions are too long." };
        agent.instructions = text;
    }

    if (patch.capabilities !== undefined) {
        const normalized = normalizeCapabilities(patch.capabilities, capabilities);
        if (!normalized.ok) return normalized;
        capabilities = normalized.value;
    } else if (resetCapabilities) {
        capabilities = [...capabilities];
    }
    agent.capabilities = [...capabilities];
    agent.canManage = managementAllowed && capabilitiesCanManage(capabilities);
    instructionsChanged = instructionsChanged || couldManage !== agent.canManage;

    if (patch.contextFiles !== undefined) {
        const files = normalizeContextFiles(patch.contextFiles);
        if (!files.ok) return files;
        agent.contextFiles = files.value;
    }
    if (patch.background !== undefined) {
        const background = cleanBackground(patch.background);
        if (!background.ok) return background;
        agent.background = background.value;
    }
    if (patch.skills !== undefined) {
        const skills = normalizeSkills(patch.skills);
        if (!skills.ok) return skills;
        agent.skills = skills.value;
    }
    if (patch.model !== undefined) {
        const model = parseModel(patch.model);
        if (!model.ok) return model;
        if (model.value) agent.model = model.value;
        else delete agent.model;
    }
    if (patch.compute !== undefined) {
        const compute = parseAgentCompute(patch.compute);
        if (!compute.ok) return compute;
        agent.compute = compute.value;
    }

    if (patch.purpose !== undefined) {
        const purpose = patch.purpose.trim();
        if (!purpose) return { ok: false, error: "Purpose cannot be empty." };
        if (purpose.length > 280) return { ok: false, error: "Purpose is too long." };
        agent.purpose = purpose;
    }

    if (patch.status !== undefined) {
        if (patch.status !== "active" && patch.status !== "archived") {
            return { ok: false, error: 'Status must be "active" or "archived".' };
        }
        if (patch.status === "active" && agent.status !== "active") {
            const active = roster.agents.filter((item) => item.status === "active").length;
            if (active >= MAX_ROSTER_AGENTS) {
                return { ok: false, error: `The roster already has ${MAX_ROSTER_AGENTS} active agents.` };
            }
        }
        agent.status = patch.status;
    }

    agent.updatedAt = now;
    return { ok: true, agent: copyAgent(agent), instructionsChanged };
}

export function rememberRun(roster: AgentRosterDocument, next: AgentRun): void {
    const current = roster.runs.find((run) => run.id === next.id);
    if (!current) {
        roster.runs.push({ ...next });
    } else {
        current.agentName = next.agentName;
        current.label = next.label;
        current.mode = next.mode;
        current.conversationId = next.conversationId;
        current.status = next.status;
        current.summary = next.summary;
        current.finishedAt = next.finishedAt;
    }
    while (roster.runs.length > MAX_ROSTER_RUNS) {
        const drop = roster.runs.findIndex((run) => run.status !== "running");
        if (drop < 0) break;
        roster.runs.splice(drop, 1);
    }
}

export function formatRosterPrompt(roster: AgentRosterDocument | undefined): string {
    const agents = roster?.agents ?? [];
    const lines = [
        "### Agent roster",
        "You are the meta-agent. The user creates and manages specialists by talking to you.",
        "agents_list shows this roster. agents_inspect shows one agent's full profile (instructions, knowledge, capabilities).",
        "agents_create adds one. Roles: coordinator, data_scientist, mlops, data_engineer, analytics_engineer, researcher, writer, reviewer, or custom with instructions.",
        "Each agent can carry its own context (background, contextFiles) and capabilities (analyst, data, datasource, databricks, coding, plugins, roster, features, all, plugin:<name>, or explicit tool names).",
        "agents_update changes the profile or status. agents_archive retires an agent. DataClaw itself stays.",
        'spawn_agent delegates a task. mode "run" (default) isolates the work and returns the result here. mode "session" continues that agent\'s own conversation.',
        "subagents_list shows delegated runs. A spawned run cannot create further agents or extend DataClaw.",
    ];
    if (agents.length === 0) {
        lines.push("No specialists yet. Create a data_scientist, mlops, data_engineer, analytics_engineer, researcher, writer, reviewer, or custom specialist when the user wants a separate agent.");
    } else {
        for (const agent of agents) {
            const ready = normalizedAgentProfile(agent);
            const context = [
                ready.background ? "notes" : "",
                ready.contextFiles.length > 0 ? `${ready.contextFiles.length} file(s)` : "",
                ready.skills.length > 0 ? `skills: ${ready.skills.join(", ")}` : "",
            ].filter(Boolean).join(", ");
            lines.push(`- [${agent.id}] ${agent.name} · ${agent.role} · ${agent.status} — ${agent.purpose}`);
            lines.push(`  capabilities: ${formatCapabilities(ready.capabilities)}${context ? ` · context: ${context}` : ""} · compute: ${formatCompute(ready.compute)}${agent.model ? ` · model: ${agent.model.provider}/${agent.model.modelId}` : ""}`);
        }
    }
    const recent = (roster?.runs ?? []).slice(-5);
    if (recent.length > 0) {
        lines.push("Recent delegated runs:");
        for (const run of recent) {
            lines.push(`- [${run.id}] ${run.agentName} · ${run.mode} · ${run.status} — ${run.label}`);
        }
    }
    return lines.join("\n");
}

export function copyAgent(agent: RosterAgent): RosterAgent {
    const ready = normalizedAgentProfile(agent);
    return {
        ...agent,
        capabilities: [...ready.capabilities],
        contextFiles: [...ready.contextFiles],
        skills: [...ready.skills],
        background: ready.background,
        compute: { ...ready.compute },
        ...(agent.model ? { model: { ...agent.model } } : {}),
    };
}

/** Old rosters may omit profile fields; read them through one normalizer. */
export function normalizedAgentProfile(agent: RosterAgent): Pick<RosterAgent, "capabilities" | "contextFiles" | "skills" | "background" | "compute"> {
    return {
        capabilities: agent.capabilities ?? defaultCapabilitiesForRole(agent.role),
        contextFiles: agent.contextFiles ?? [],
        skills: agent.skills ?? [],
        background: agent.background ?? "",
        compute: normalizedCompute(agent.compute),
    };
}

function cleanName(name: string): { ok: true; value: string } | { ok: false; error: string } {
    const value = name.trim().replace(/\s+/g, " ");
    if (!value) return { ok: false, error: "An agent needs a name." };
    if (value.length > 64) return { ok: false, error: "Agent names are limited to 64 characters." };
    return { ok: true, value };
}

function resolveRole(
    role: string,
    instructions: string | undefined,
    purpose: string | undefined,
): {
    ok: true;
    role: string;
    purpose: string;
    instructions: string;
    roleCapabilities: string[];
} | { ok: false; error: string } {
    const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const customInstructions = instructions?.trim() ?? "";
    const customPurpose = purpose?.trim() ?? "";
    if (customPurpose.length > 280) return { ok: false, error: "Purpose is too long." };
    if (customInstructions.length > 6_000) return { ok: false, error: "Instructions are too long." };

    if (normalized === "custom") {
        if (customInstructions.length < 12) {
            return { ok: false, error: "A custom agent needs instructions of at least a sentence." };
        }
        return {
            ok: true,
            role: "custom",
            purpose: customPurpose || "Custom specialist",
            instructions: customInstructions,
            roleCapabilities: [...DEFAULT_SPECIALIST_CAPABILITIES],
        };
    }

    if (!isRoleName(normalized)) {
        return {
            ok: false,
            error: `Unknown role "${role}". Use one of: ${ROLE_NAMES.join(", ")}, or custom with instructions.`,
        };
    }

    const template = AGENT_ROLES[normalized];
    if (customInstructions.length > 0 && customInstructions.length < 12) {
        return { ok: false, error: "Instructions need at least a sentence." };
    }
    return {
        ok: true,
        role: normalized,
        purpose: customPurpose || template.purpose,
        instructions: customInstructions || template.instructions,
        roleCapabilities: [...template.capabilities],
    };
}

/** Fixed specialists cannot be widened into managers; a custom agent can ask for the roster. */
function roleAllowsManagement(role: string): boolean {
    return role === "coordinator" || role === "custom";
}

function normalizeCapabilities(
    capabilities: readonly string[] | undefined,
    fallback: readonly string[],
): { ok: true; value: string[] } | { ok: false; error: string } {
    const list = capabilities === undefined ? fallback : capabilities;
    if (capabilities !== undefined && list.length === 0) {
        return { ok: false, error: "An agent needs at least one capability, or omit capabilities for the role default." };
    }
    if (list.length > 40) return { ok: false, error: "Too many capabilities." };

    const value: string[] = [];
    for (const raw of list) {
        if (typeof raw !== "string") return { ok: false, error: "Capabilities must be strings." };
        const capability = raw.trim();
        if (!capability) continue;
        if (capability.length > 120) return { ok: false, error: `Capability "${capability.slice(0, 40)}…" is too long.` };
        if (!/^(all|[a-z][a-z0-9_]*|plugin:[a-z0-9][a-z0-9_.-]*|tool:[a-zA-Z0-9_.:-]+|[a-zA-Z0-9_.:-]+)$/.test(capability)) {
            return { ok: false, error: `Invalid capability "${capability}".` };
        }
        if (!value.includes(capability)) value.push(capability);
    }
    if (value.length === 0) return { ok: false, error: "An agent needs at least one capability." };
    return { ok: true, value };
}

function normalizeContextFiles(
    files: readonly string[] | undefined,
): { ok: true; value: string[] } | { ok: false; error: string } {
    if (!files || files.length === 0) return { ok: true, value: [] };
    if (files.length > 32) return { ok: false, error: "An agent can read at most 32 context files." };
    const value: string[] = [];
    for (const raw of files) {
        if (typeof raw !== "string") return { ok: false, error: "Context files must be strings." };
        const file = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
        if (!file) continue;
        if (file.length > 400) return { ok: false, error: "A context file path is too long." };
        if (file.startsWith("/") || file.split("/").includes("..")) {
            return { ok: false, error: `Context file "${file}" must be relative and stay inside the workspace.` };
        }
        if (!/\.(md|txt|json|csv|tsv|ya?ml|sql|ts|tsx|js|jsx)$/i.test(file)) {
            return { ok: false, error: `Context file "${file}" must be text (md, txt, json, csv, yaml, sql, ts, js).` };
        }
        if (!value.includes(file)) value.push(file);
    }
    return { ok: true, value };
}

function cleanBackground(background: string | undefined): { ok: true; value: string } | { ok: false; error: string } {
    const value = (background ?? "").trim();
    if (value.length > 8_000) return { ok: false, error: "Background notes are limited to 8000 characters." };
    return { ok: true, value };
}

function normalizeSkills(skills: readonly string[] | undefined): { ok: true; value: string[] } | { ok: false; error: string } {
    if (!skills || skills.length === 0) return { ok: true, value: [] };
    if (skills.length > 32) return { ok: false, error: "An agent can select at most 32 skills." };
    const value: string[] = [];
    for (const raw of skills) {
        if (typeof raw !== "string") return { ok: false, error: "Skills must be strings." };
        const name = raw.trim();
        if (!name) continue;
        if (!/^[a-z0-9][a-z0-9_.-]*$/.test(name)) return { ok: false, error: `Invalid skill name "${name}".` };
        if (!value.includes(name)) value.push(name);
    }
    return { ok: true, value };
}

function parseModel(model: string | undefined): {
    ok: true;
    value?: { provider: string; modelId: string };
} | { ok: false; error: string } {
    const raw = (model ?? "").trim();
    if (!raw) return { ok: true };
    const slash = raw.indexOf("/");
    if (slash <= 0 || slash === raw.length - 1) {
        return { ok: false, error: 'Model must be "provider/modelId" (for example "opencode-go/deepseek-v4.1-flash").' };
    }
    const provider = raw.slice(0, slash).trim();
    const modelId = raw.slice(slash + 1).trim();
    if (!provider || !modelId) return { ok: false, error: 'Model must be "provider/modelId".' };
    return { ok: true, value: { provider, modelId } };
}

function isRoleName(role: string): role is AgentRoleName {
    return Object.hasOwn(AGENT_ROLES, role);
}
