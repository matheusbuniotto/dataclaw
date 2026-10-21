import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAnalystHarness } from "../src/harness";
import { readWorkspace } from "../src/prototype/workspace";
import {
    MAX_ROSTER_AGENTS,
    MAX_ROSTER_RUNS,
    applyAgentUpdate,
    allocateAgentId,
    managementRefusal,
    prepareAgent,
    rememberRun,
    type AgentRosterDocument,
    type AgentRun,
} from "../src/docs/agents";

function emptyRoster(): AgentRosterDocument {
    return { agents: [], runs: [] };
}

test("roster ids, roles, and the management boundary", () => {
    expect(allocateAgentId(["dataclaw"], "Churn Analyst")).toBe("churn-analyst");
    expect(allocateAgentId(["churn-analyst"], "Churn Analyst")).toBe("churn-analyst-2");
    expect(allocateAgentId([], "main")).toBe("main-2");

    const roster = emptyRoster();
    const created = prepareAgent(roster, { name: "Churn Analyst", role: "researcher" }, 1);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    roster.agents.push(created.agent);

    const duplicate = prepareAgent(roster, { name: "churn analyst", role: "writer" }, 2);
    expect(duplicate.ok).toBe(false);

    const unknown = prepareAgent(emptyRoster(), { name: "Scout", role: "detective" }, 3);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain("researcher");

    const custom = prepareAgent(emptyRoster(), { name: "Scout", role: "custom", instructions: "" }, 4);
    expect(custom.ok).toBe(false);

    const full = emptyRoster();
    for (let i = 0; i < MAX_ROSTER_AGENTS; i++) {
        const agent = prepareAgent(full, { name: `Agent ${i}`, role: "writer" }, i);
        expect(agent.ok).toBe(true);
        if (agent.ok) full.agents.push(agent.agent);
    }
    const overflow = prepareAgent(full, { name: "One more", role: "writer" }, 100);
    expect(overflow.ok).toBe(false);

    const archived = applyAgentUpdate(roster, "churn-analyst", { status: "archived" }, 5);
    expect(archived.ok).toBe(true);
    const restored = prepareAgent(roster, { name: "Churn Analyst", role: "researcher" }, 6);
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.error).toContain("archived");

    expect(managementRefusal({ agentId: "", origin: "roster" }, roster)).toBeUndefined();
    expect(managementRefusal({ agentId: "", origin: "run" }, roster)).toContain("spawned run");
    expect(managementRefusal({ agentId: "churn-analyst", origin: "roster" }, roster)).toContain("cannot manage");
});

test("finished delegated runs are dropped before running ones", () => {
    const roster = emptyRoster();
    for (let i = 0; i < MAX_ROSTER_RUNS; i++) {
        rememberRun(roster, run(i, i === 3 ? "running" : "finished"));
    }
    expect(roster.runs).toHaveLength(MAX_ROSTER_RUNS);
    rememberRun(roster, run(MAX_ROSTER_RUNS, "finished"));
    expect(roster.runs).toHaveLength(MAX_ROSTER_RUNS);
    expect(roster.runs.some((item) => item.id === "run-0")).toBe(false);
    expect(roster.runs.some((item) => item.id === "run-3")).toBe(true);
});

test("chat creates a specialist, delegates a run, and archives it", async () => {
    const faux = fauxProvider({
        provider: "faux",
        models: [{ id: "test-model", name: "Test model" }],
    });
    const tool = (name: string, args: Record<string, string>) =>
        fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

    faux.setResponses([
        tool("agents_create", { name: "Churn Analyst", role: "researcher" }),
        fauxAssistantMessage("Created the researcher."),
        tool("spawn_agent", {
            agentId: "churn-analyst",
            task: "Profile the churn file and report the seasonal pattern.",
            mode: "run",
        }),
        fauxAssistantMessage("Churn is seasonal in the March cohort."),
        fauxAssistantMessage("The researcher found a seasonal pattern."),
        tool("spawn_agent", {
            agentId: "churn-analyst",
            task: "Remember that March is the cohort to watch.",
            mode: "session",
        }),
        fauxAssistantMessage("Session note: March cohort."),
        fauxAssistantMessage("Saved on the researcher's own session."),
        tool("agents_archive", { agentId: "churn-analyst" }),
        fauxAssistantMessage("Archived churn-analyst."),
        tool("spawn_agent", { agentId: "churn-analyst", task: "Look again.", mode: "run" }),
        fauxAssistantMessage("That agent is archived."),
    ]);

    const projectRoot = await mkdtemp(join(tmpdir(), "dataclaw-agents-"));
    const analyst = await createAnalystHarness({
        storagePath: ":memory:",
        resume: false,
        databricks: false,
        fauxHandle: faux,
        model: { provider: "faux", modelId: "test-model" },
        projectRoot,
        workspaceDir: join(projectRoot, "workspace"),
    });

    try {
        const root = await analyst.conversation.agent(analyst.context);
        expect(root.tools.map((item) => item.name)).toContain("spawn_agent");
        expect(root.instructions).toContain("spawn_agent");

        await turn(analyst, "Create a researcher named Churn Analyst.", "create-agent");
        const created = await analyst.getRoster();
        const specialist = created?.agents.find((agent) => agent.id === "churn-analyst");
        expect(specialist?.role).toBe("researcher");
        expect(specialist?.status).toBe("active");
        expect(specialist?.canManage).toBe(false);

        const session = await analyst.harness.conversation(specialist!.conversationId as never, analyst.context);
        const configured = await session!.agent(analyst.context);
        expect(configured.instructions).toContain("researcher");
        expect(configured.tools.map((item) => item.name)).not.toContain("spawn_agent");
        expect(configured.tools.map((item) => item.name)).toContain("query_data");

        const workspace = await readWorkspace(analyst);
        expect(workspace.roster.some((agent) => agent.id === "churn-analyst")).toBe(true);
        expect(workspace.agent.sources).toContain("Agent roster");

        const specialistView = await readWorkspace(analyst, { agentId: "churn-analyst" });
        expect(specialistView.agent.id).toBe("churn-analyst");
        expect(specialistView.agent.name).toBe("Churn Analyst");
        expect(specialistView.agent.sources.join(" ")).toContain("researcher specialist");

        const stale = await readWorkspace(analyst, { agentId: "nope" });
        expect(stale.agent.id).toBe("dataclaw");

        await turn(analyst, "Ask churn-analyst to profile the file.", "delegate-agent");
        const delegated = await analyst.getRoster();
        const run = delegated?.runs.find((item) => item.agentId === "churn-analyst");
        expect(run?.status).toBe("finished");
        expect(run?.mode).toBe("run");
        expect(run?.summary).toContain("seasonal");

        await turn(analyst, "Continue that session.", "delegate-session");
        const sessionRun = (await analyst.getRoster())?.runs.find((item) => item.mode === "session");
        expect(sessionRun?.status).toBe("finished");
        expect(sessionRun?.summary).toContain("March cohort");
        expect(sessionRun?.conversationId).toBe(specialist?.conversationId);

        const afterDelegate = await readWorkspace(analyst);
        expect(afterDelegate.runs.some((item) => item.agentId === "churn-analyst" && item.status === "Completed")).toBe(true);

        await turn(analyst, "Archive churn-analyst.", "archive-agent");
        const archived = await analyst.getRoster();
        expect(archived?.agents.find((agent) => agent.id === "churn-analyst")?.status).toBe("archived");

        await turn(analyst, "Ask them to look again.", "delegate-archived");
        const refused = await analyst.getRoster();
        expect(refused?.runs.filter((item) => item.agentId === "churn-analyst")).toHaveLength(2);
        const view = await analyst.conversation.context(analyst.context);
        expect(JSON.stringify(view.messages)).toContain("archived");
    } finally {
        await analyst.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

function run(id: number, status: AgentRun["status"]): AgentRun {
    return {
        id: `run-${id}`,
        agentId: "writer",
        agentName: "Writer",
        label: `Task ${id}`,
        mode: "run",
        conversationId: id,
        status,
        summary: "",
        startedAt: id,
        finishedAt: status === "running" ? 0 : id + 1,
    };
}

async function turn(
    analyst: Awaited<ReturnType<typeof createAnalystHarness>>,
    content: string,
    requestId: string,
): Promise<void> {
    await analyst.conversation.submit(
        { type: "input", content, requestId },
        analyst.context,
    );
    await analyst.conversation.waitForIdle(analyst.context);
}
