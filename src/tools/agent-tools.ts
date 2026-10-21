import { Type } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord/context";
import { AgentDoc, AssistantEntry, configure, defineTool, type ConversationId, type ToolRegistration, type Tx } from "@earendil-works/pi-durable";
import {
    AgentBindingDoc,
    AgentRosterDoc,
    applyAgentUpdate,
    copyAgent,
    formatRosterPrompt,
    managementRefusal,
    prepareAgent,
    rememberRun,
    type AgentRun,
    type RosterAgent,
} from "../docs/agents";

const managementTools: ToolRegistration[] = [];

function textResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

function assistantText(message: AssistantMessage | undefined): string {
    if (!message) return "";
    const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
    if (text) return text;
    return message.stopReason === "error" ? (message.errorMessage ?? "The model returned an error.") : "";
}

async function refuseIfUnmanaged(
    api: { commit: <T>(change: (tx: Tx) => Promise<T>, context: Context) => Promise<T>; conversationId: ConversationId },
    context: Context,
): Promise<string | undefined> {
    return api.commit(async (tx) => {
        const binding = await tx.doc(AgentBindingDoc, api.conversationId);
        const roster = await tx.doc(AgentRosterDoc);
        return managementRefusal(binding, roster);
    }, context);
}

export const agentsListTool = defineTool({
    name: "agents_list",
    description: "Lists the specialists the user can create and manage from this chat, including role, status, and recent delegated runs.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api, context) => {
        const refusal = await refuseIfUnmanaged(api, context);
        if (refusal) return textResult(refusal);
        const text = await api.commit(async (tx) => formatRosterPrompt(await tx.doc(AgentRosterDoc)), context);
        return textResult(text);
    },
});

export const agentsCreateTool = defineTool({
    name: "agents_create",
    description: "Creates a persistent specialist the user can keep. Roles: coordinator, researcher, writer, reviewer, or custom (custom requires instructions). The new agent gets its own conversation.",
    parameters: Type.Object({
        name: Type.String({ description: "Display name, such as Churn Analyst" }),
        role: Type.String({ description: "coordinator, researcher, writer, reviewer, or custom" }),
        instructions: Type.Optional(Type.String({ description: "Operating instructions. Required for custom. Replaces the role template when set." })),
        purpose: Type.Optional(Type.String({ description: "One line describing what this agent is for" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        const created = await api.commit(async (tx) => {
            const binding = await tx.doc(AgentBindingDoc, api.conversationId);
            const roster = await tx.doc(AgentRosterDoc);
            const refusal = managementRefusal(binding, roster);
            if (refusal) return { ok: false as const, error: refusal };

            const marker = `create:${String(api.taskId)}`;
            const replayed = roster.agents.find((agent) => agent.createdByTask === marker);
            if (replayed) return { ok: true as const, agent: copyAgent(replayed) };

            const planned = prepareAgent(roster, args, Date.now());
            if (!planned.ok) return planned;

            const parent = await tx.doc(AgentDoc, api.conversationId);
            if (!parent.model) {
                return { ok: false as const, error: "The coordinator has no model configured, so a specialist cannot be created." };
            }

            const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
            const agent: RosterAgent = {
                ...planned.agent,
                conversationId: Number(conversation.id),
                createdByTask: marker,
            };
            await configureSpecialist(tx, conversation.id, agent, parent, agent.canManage ? "session" : "run");
            const childBinding = await tx.doc(AgentBindingDoc, conversation.id);
            childBinding.agentId = agent.id;
            childBinding.origin = "roster";
            roster.agents.push(agent);
            return { ok: true as const, agent: copyAgent(agent) };
        }, context);

        if (!created.ok) return textResult(created.error);
        api.output(`Created ${created.agent.role} ${created.agent.name}.\n`);
        return textResult([
            `Created ${created.agent.role} "${created.agent.name}" (id: ${created.agent.id}).`,
            `Purpose: ${created.agent.purpose}`,
            `Delegate with spawn_agent agentId "${created.agent.id}".`,
        ].join("\n"));
    },
});

export const agentsUpdateTool = defineTool({
    name: "agents_update",
    description: "Updates a specialist's name, role, instructions, purpose, or status (active or archived). Restoring an archived agent sets status to active.",
    parameters: Type.Object({
        agentId: Type.String({ description: "Roster id from agents_list, such as churn-analyst" }),
        name: Type.Optional(Type.String()),
        role: Type.Optional(Type.String()),
        instructions: Type.Optional(Type.String()),
        purpose: Type.Optional(Type.String()),
        status: Type.Optional(Type.String({ description: "active or archived" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        const updated = await api.commit(async (tx) => {
            const binding = await tx.doc(AgentBindingDoc, api.conversationId);
            const roster = await tx.doc(AgentRosterDoc);
            const refusal = managementRefusal(binding, roster);
            if (refusal) return { ok: false as const, error: refusal };

            const result = applyAgentUpdate(roster, args.agentId, args, Date.now());
            if (!result.ok) return result;
            const stored = roster.agents.find((agent) => agent.id === result.agent.id);
            const parent = await tx.doc(AgentDoc, api.conversationId);
            if (stored && stored.conversationId > 0) {
                await configure(tx, stored.conversationId as ConversationId, {
                    instructions: stored.instructions,
                    ...(parent.model ? { model: { provider: parent.model.provider, modelId: parent.model.modelId } } : {}),
                    tools: stored.canManage ? null : { remove: managementTools },
                });
            }
            return { ok: true as const, agent: result.agent };
        }, context);

        if (!updated.ok) return textResult(updated.error);
        return textResult(`Updated [${updated.agent.id}] ${updated.agent.name} · ${updated.agent.role} · ${updated.agent.status}.`);
    },
});

export const agentsArchiveTool = defineTool({
    name: "agents_archive",
    description: "Retires a specialist. Its conversation is kept, and spawn_agent will refuse it until agents_update sets status back to active.",
    parameters: Type.Object({
        agentId: Type.String({ description: "Roster id to archive" }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        const archived = await api.commit(async (tx) => {
            const binding = await tx.doc(AgentBindingDoc, api.conversationId);
            const roster = await tx.doc(AgentRosterDoc);
            const refusal = managementRefusal(binding, roster);
            if (refusal) return { ok: false as const, error: refusal };
            return applyAgentUpdate(roster, args.agentId, { status: "archived" }, Date.now());
        }, context);
        if (!archived.ok) return textResult(archived.error);
        return textResult(`Archived [${archived.agent.id}] ${archived.agent.name}. Restore it with agents_update status "active".`);
    },
});

export const spawnAgentTool = defineTool({
    name: "spawn_agent",
    description: "Delegates one task to a roster agent and waits for the answer. mode run (default) is an isolated subagent. mode session continues that agent's own conversation. Spawned runs cannot delegate further.",
    parameters: Type.Object({
        agentId: Type.String({ description: "Roster id from agents_list" }),
        task: Type.String({ description: "What the specialist should do, including the evidence they need" }),
        mode: Type.Optional(Type.String({ description: 'run (default) or session' })),
        label: Type.Optional(Type.String({ description: "Short title for the run list" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
        const mode = args.mode?.trim() || "run";
        if (mode !== "run" && mode !== "session") {
            return textResult('mode must be "run" or "session".');
        }
        const task = args.task.trim();
        if (!task) return textResult("spawn_agent needs a task.");
        if (task.length > 8_000) return textResult("That task is too long.");
        const label = (args.label?.trim() || task).slice(0, 120);
        const runId = `run-${String(api.taskId)}`;

        const opened = await api.commit(async (tx) => {
            const binding = await tx.doc(AgentBindingDoc, api.conversationId);
            const roster = await tx.doc(AgentRosterDoc);
            const refusal = managementRefusal(binding, roster);
            if (refusal) return { ok: false as const, error: refusal };

            const agent = roster.agents.find((item) => item.id === args.agentId);
            if (!agent) return { ok: false as const, error: `No agent with id "${args.agentId}". Use agents_list.` };
            if (agent.status !== "active") {
                return { ok: false as const, error: `${agent.name} is archived. Restore it with agents_update before delegating.` };
            }
            if (binding.agentId === agent.id) return { ok: false as const, error: "An agent cannot delegate to itself." };

            const parent = await tx.doc(AgentDoc, api.conversationId);
            let conversationId = agent.conversationId;
            if (mode === "run") {
                const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
                if (existing) {
                    conversationId = Number(existing.id);
                } else {
                    if (!parent.model) {
                        return { ok: false as const, error: "The coordinator has no model configured, so the run cannot start." };
                    }
                    const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
                    conversationId = Number(created.id);
                    await configureSpecialist(tx, created.id, agent, parent, "run");
                    const childBinding = await tx.doc(AgentBindingDoc, created.id);
                    childBinding.agentId = agent.id;
                    childBinding.origin = "run";
                }
            } else if (conversationId <= 0) {
                return { ok: false as const, error: `${agent.name} has no session yet.` };
            }

            const existingRun = roster.runs.find((run) => run.id === runId);
            if (!existingRun || existingRun.status === "running") {
                rememberRun(roster, {
                    id: runId,
                    agentId: agent.id,
                    agentName: agent.name,
                    label,
                    mode,
                    conversationId,
                    status: "running",
                    summary: existingRun?.summary ?? "",
                    startedAt: existingRun?.startedAt ?? Date.now(),
                    finishedAt: 0,
                });
            }
            return {
                ok: true as const,
                conversationId,
                agentName: agent.name,
                role: agent.role,
            };
        }, context);

        if (!opened.ok) return textResult(opened.error);
        await api.details({ conversationId: opened.conversationId }, context);
        api.output(`Delegating to ${opened.agentName} (${mode}).\n`);

        const child = await api.conversation(opened.conversationId as ConversationId, context);
        if (!child) return textResult(`Failed to load the conversation for ${opened.agentName}.`);

        const prompt = [
            `You are working a single delegated task for the coordinator.`,
            `Agent: ${opened.agentName} (${opened.role})`,
            `Task: ${task}`,
            `Return the result. Cite the queries and files you actually used.`,
        ].join("\n");

        try {
            const submission = await child.submit(
                {
                    type: "input",
                    content: prompt,
                    requestId: `spawn:${String(api.taskId)}`,
                },
                context,
            );
            const settled = await submission.wait(context);
            const answer = settled.status === "done"
                ? await api.commit(async (tx) => {
                    const entry = await tx.entry(AssistantEntry, settled.answer);
                    return assistantText(entry?.model?.[0] as AssistantMessage | undefined);
                }, context)
                : "";
            const summary = answer || (settled.status === "unanswered"
                ? `The run ended unanswered (${settled.reason}).`
                : "The agent finished without a text answer.");
            await finishRun(api, context, runId, answer ? "finished" : "failed", summary);
            return textResult(`### ${opened.agentName}\n${summary}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await finishRun(api, context, runId, "failed", message);
            return textResult(`Delegation to ${opened.agentName} failed: ${message}`);
        }
    },
});

export const subagentsListTool = defineTool({
    name: "subagents_list",
    description: "Lists delegated runs spawned from this chat: agent, mode, status, and the latest summary.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api, context) => {
        const refusal = await refuseIfUnmanaged(api, context);
        if (refusal) return textResult(refusal);
        const text = await api.commit(async (tx) => {
            const runs = (await tx.doc(AgentRosterDoc)).runs;
            if (runs.length === 0) return "No delegated runs yet. Use spawn_agent to give a specialist a task.";
            const lines = runs.slice(-20).map((run: AgentRun) => {
                const summary = run.summary ? ` — ${run.summary.slice(0, 180)}` : "";
                return `- [${run.id}] ${run.agentName} (${run.agentId}) · ${run.mode} · ${run.status}${summary}`;
            });
            return ["Delegated runs:", ...lines].join("\n");
        }, context);
        return textResult(text);
    },
});

managementTools.push(
    agentsListTool,
    agentsCreateTool,
    agentsUpdateTool,
    agentsArchiveTool,
    spawnAgentTool,
    subagentsListTool,
);

async function configureSpecialist(
    tx: Parameters<typeof configure>[0],
    conversationId: ConversationId,
    agent: RosterAgent,
    parent: { model?: { provider: string; modelId: string }; cwd?: string },
    mode: "run" | "session",
): Promise<void> {
    const isolate = mode === "run" || !agent.canManage;
    await configure(tx, conversationId, {
        model: parent.model ? { provider: parent.model.provider, modelId: parent.model.modelId } : undefined,
        ...(parent.cwd ? { cwd: parent.cwd } : {}),
        instructions: agent.instructions,
        ...(isolate ? { tools: { remove: managementTools } } : {}),
    });
}

async function finishRun(
    api: { commit: <T>(change: (tx: Tx) => Promise<T>, context: Context) => Promise<T> },
    context: Context,
    runId: string,
    status: "finished" | "failed",
    summary: string,
): Promise<void> {
    await api.commit(async (tx) => {
        const roster = await tx.doc(AgentRosterDoc);
        const run = roster.runs.find((item: AgentRun) => item.id === runId);
        if (!run) return;
        run.status = status;
        run.summary = summary.slice(0, 500);
        run.finishedAt = Date.now();
    }, context);
}
