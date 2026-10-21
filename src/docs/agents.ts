import { defineDoc } from "@earendil-works/pi-durable";

/** Active specialists the coordinator may keep. Archived agents do not count. */
export const MAX_ROSTER_AGENTS = 24;
/** Delegated runs kept on the roster. Older finished runs drop first. */
export const MAX_ROSTER_RUNS = 40;

export interface AgentRoleTemplate {
    title: string;
    purpose: string;
    canManage: boolean;
    instructions: string;
}

export const AGENT_ROLES = {
    coordinator: {
        title: "Coordinator",
        purpose: "Single point of contact. Create specialists and delegate work.",
        canManage: true,
        instructions: [
            "You are a coordinator for DataClaw, the user's point of contact for a team of specialists.",
            "Create and update agents with the agents_* tools. Delegate with spawn_agent.",
            "Use mode run when the user wants the answer in this chat. Use mode session when they want that agent's own ongoing conversation.",
            "Do small tasks yourself. Delegate research, drafting, and review when the user asks for a separate agent.",
            "Record durable findings on this conversation after a specialist returns evidence.",
        ].join("\n"),
    },
    researcher: {
        title: "Researcher",
        purpose: "Gather evidence and return a cited brief.",
        canManage: false,
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
        instructions: [
            "You are a reviewer for DataClaw. Check the task's claim against evidence and return actionable findings.",
            "Name what holds, what is weak, and what to measure next.",
            "When data access is available, re-run the evidence query before you agree with the claim.",
            "Do not create agents or spawn subagents.",
        ].join("\n"),
    },
} as const satisfies Record<string, AgentRoleTemplate>;

export type AgentRoleName = keyof typeof AGENT_ROLES;

export interface RosterAgent {
    id: string;
    name: string;
    role: string;
    purpose: string;
    instructions: string;
    status: "active" | "archived";
    canManage: boolean;
    /** Ownerless conversation that holds this agent's own session. */
    conversationId: number;
    /** Tool task that created the agent, so a replay does not create a second one. */
    createdByTask: string;
    createdAt: number;
    updatedAt: number;
}

export interface AgentRun {
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
}

export interface AgentRosterDocument {
    agents: RosterAgent[];
    runs: AgentRun[];
}

export interface AgentBindingDocument {
    /** Empty on the root coordinator. A roster id on a specialist session. */
    agentId: string;
    /** `run` is a one-shot delegation and cannot manage the roster. */
    origin: "roster" | "run";
}

export const AgentRosterDoc = defineDoc<AgentRosterDocument>({
    kind: "analyst.agent_roster",
    version: 1,
    scope: "session",
    initial: () => ({ agents: [], runs: [] }),
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
}

export interface AgentPatch {
    name?: string | undefined;
    role?: string | undefined;
    instructions?: string | undefined;
    purpose?: string | undefined;
    status?: string | undefined;
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

    return {
        ok: true,
        agent: {
            id: allocateAgentId(roster.agents.map((agent) => agent.id), name.value),
            name: name.value,
            role: resolved.role,
            purpose: resolved.purpose,
            instructions: resolved.instructions,
            status: "active",
            canManage: resolved.canManage,
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
        || patch.status !== undefined;
    if (!hasPatch) return { ok: false, error: "Nothing to update. Pass a name, role, instructions, purpose, or status." };

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
    if (patch.role !== undefined) {
        const switching = patch.role.trim().toLowerCase() !== agent.role;
        const resolved = resolveRole(
            patch.role,
            patch.instructions !== undefined ? patch.instructions : (switching ? undefined : agent.instructions),
            patch.purpose ?? agent.purpose,
        );
        if (!resolved.ok) return resolved;
        instructionsChanged = instructionsChanged || resolved.instructions !== agent.instructions || couldManage !== resolved.canManage;
        agent.role = resolved.role;
        agent.canManage = resolved.canManage;
        agent.instructions = resolved.instructions;
    } else if (patch.instructions !== undefined) {
        const text = patch.instructions.trim();
        if (text.length < 12) return { ok: false, error: "Instructions need at least a sentence." };
        if (text.length > 6_000) return { ok: false, error: "Instructions are too long." };
        agent.instructions = text;
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
        "agents_list shows this roster. agents_create adds one (coordinator, researcher, writer, reviewer, or custom with instructions).",
        "agents_update changes name, role, instructions, purpose, or status. agents_archive retires an agent. DataClaw itself stays.",
        'spawn_agent delegates a task. mode "run" (default) isolates the work and returns the result here. mode "session" continues that agent\'s own conversation.',
        "subagents_list shows delegated runs. A spawned run cannot create further agents.",
    ];
    if (agents.length === 0) {
        lines.push("No specialists yet. Create a researcher, writer, or reviewer when the user wants a separate agent.");
    } else {
        for (const agent of agents) {
            lines.push(`- [${agent.id}] ${agent.name} · ${agent.role} · ${agent.status} — ${agent.purpose}`);
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
    return { ...agent };
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
): { ok: true; role: string; purpose: string; instructions: string; canManage: boolean } | { ok: false; error: string } {
    const normalized = role.trim().toLowerCase();
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
            canManage: false,
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
        canManage: template.canManage,
    };
}

function isRoleName(role: string): role is AgentRoleName {
    return Object.prototype.hasOwnProperty.call(AGENT_ROLES, role);
}
