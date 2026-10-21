import { describeDatabricksConfig } from "../mcp/databricks-config";
import { createAnalystHarness } from "../harness";
import { MAIN_AGENT_DESCRIPTION, MAIN_AGENT_NAME } from "../agent/instructions";
import { releaseSharedAdapter, setSharedAdapter } from "../tools/analyst-tools";
import { noteDatabricksAdapter } from "../tools/databricks-tools";
import { DatabricksDataAdapter } from "../adapters/databricks-adapter";
import { databricksRecord } from "../datasource/providers/databricks";
import { AnalystPlanDoc } from "../docs/plan";
import { FindingsDoc } from "../docs/findings";
import { PlaybookDoc } from "../docs/playbook";
import {
    adoptDatabricksAdapter,
    getDatabricksUiStatus,
    recordDatabricksAuthError,
    subscribeDatabricks,
} from "./databricks-api";
import { loadSkills } from "../workspace/context";
import type { AgentRosterDocument, AgentRun, RosterAgent } from "../docs/agents";
import { normalizedAgentProfile } from "../docs/agents";
import { formatCapabilities } from "../docs/agent-capabilities";
import { formatCompute } from "../compute/agent-compute";
import { pluginsSummary } from "./plugins-api";
import type {
    ActivityItem,
    Checkpoint,
    DataSource,
    RosterEntry,
    Run,
    ToolInvocation,
    TranscriptItem,
    WorkspaceSnapshot,
} from "./workspace-types";

type AnalystHarness = Awaited<ReturnType<typeof createAnalystHarness>>;

const LOCAL_FILES = ["sample-data/customer_churn.csv", "sample-data/incident_logs.json"];
const PI_TASKS = new Set(["pi.generation", "pi.tool", "pi.compaction"]);

const CAPABILITIES = [
    "Databricks MCP",
    "Local CSV / JSON",
    "Analyst plan",
    "Findings",
    "Playbook",
    "Auditor",
    "Agent roster",
    "Agent profiles",
    "Self-extension",
];

let opening: Promise<AnalystHarness> | undefined;
/** The open harness, so a capability change can close and reopen it. */
let open: AnalystHarness | undefined;
/** Detaches this harness from the Databricks session listeners before it closes. */
let detachDatabricks: (() => void) | undefined;
/** Set while Stop is in flight so an ask that has not been submitted yet is aborted after submit. */
let cancelAsk = false;

/** The console's single root conversation. Later calls share the same harness. */
export function consoleHarness(): Promise<AnalystHarness> {
    opening ??= startConsoleHarness()
        .then((analyst) => {
            open = analyst;
            return analyst;
        })
        .catch((err) => {
            opening = undefined;
            throw err;
        });
    return opening;
}

export function resetConsoleHarness(): void {
    opening = undefined;
    open = undefined;
    detachDatabricks?.();
    detachDatabricks = undefined;
}

/**
 * Close the harness and open it again so a capability change (a plugin enabled, a skill
 * added) takes effect. The conversation resumes from SQLite; nothing in flight is lost
 * because a busy agent refuses the change first.
 */
export async function reloadConsoleHarness(): Promise<WorkspaceSnapshot> {
    const analyst = open ?? await consoleHarness();
    const inspection = await analyst.harness.inspect(analyst.context);
    const live = new Set(inspection.tasks.map((task) => String(task.record.conversationId)));
    if (inspection.tasks.length > 0 || inspection.submissions.some((submission) => submissionKeepsAgentBusy(submission, live))) {
        throw new Error("DataClaw is working. Stop the turn before applying capability changes.");
    }
    // Stop listening before closing: an adapter that connects mid-reload would otherwise
    // commit to a closed session and take the process down.
    detachDatabricks?.();
    detachDatabricks = undefined;
    await analyst.close();
    resetConsoleHarness();
    return consoleWorkspace();
}

async function startConsoleHarness(): Promise<AnalystHarness> {
    const storagePath = process.env.ANALYST_STORAGE ?? "./agent_analyst.sqlite";
    const analyst = await createAnalystHarness({
        storagePath,
        resume: true,
        // Connect in the background so the console can render before MCP auth finishes.
        databricks: false,
    });

    let attached = false;
    detachDatabricks = subscribeDatabricks((adapter) => {
        if (adapter) {
            attached = true;
            void rememberDatabricks(analyst, adapter);
            return;
        }
        if (!attached) return;
        attached = false;
        void forgetDatabricks(analyst);
    });

    if (describeDatabricksConfig().configured) {
        void DatabricksDataAdapter.connect({})
            .then((adapter) => adoptDatabricksAdapter(adapter))
            .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                recordDatabricksAuthError(message);
                console.error(`Databricks MCP connect failed: ${message}`);
            });
    }

    return analyst;
}

async function rememberDatabricks(analyst: AnalystHarness, adapter: DatabricksDataAdapter): Promise<void> {
    setSharedAdapter(adapter);
    noteDatabricksAdapter(adapter);
    // The adapter may finish connecting after a capability reload closed this harness.
    await rememberDatabricksPlan(analyst, adapter).catch((err: unknown) => {
        console.error(`could not record the Databricks session: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function rememberDatabricksPlan(analyst: AnalystHarness, adapter: DatabricksDataAdapter): Promise<void> {
    const host = adapter.options.host ?? "unknown";
    await analyst.conversation.commit(async (tx) => {
        const plan = await tx.doc(AnalystPlanDoc, analyst.conversation.id);
        const sameWorkspace = plan.dataSource?.host === host;
        plan.dataSource = databricksRecord({
            host,
            ...(adapter.options.mcpUrl ? { mcpUrl: adapter.options.mcpUrl } : {}),
            ...(adapter.options.profile ? { profile: adapter.options.profile } : {}),
            connectedAt: sameWorkspace ? plan.dataSource?.connectedAt ?? Date.now() : Date.now(),
        });
        plan.updatedAt = Date.now();
    }, analyst.context);
}

async function forgetDatabricks(analyst: AnalystHarness): Promise<void> {
    noteDatabricksAdapter(null);
    releaseSharedAdapter();
    await forgetDatabricksPlan(analyst).catch((err: unknown) => {
        console.error(`could not clear the Databricks session: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function forgetDatabricksPlan(analyst: AnalystHarness): Promise<void> {
    await analyst.conversation.commit(async (tx) => {
        const plan = await tx.doc(AnalystPlanDoc, analyst.conversation.id);
        delete plan.dataSource;
        plan.updatedAt = Date.now();
    }, analyst.context);
}

export async function askMainAgent(content: string, agentId?: string): Promise<{ submissionId: string; agentId: string }> {
    const trimmed = content.trim();
    const analyst = await consoleHarness();
    const target = await resolveConsoleTarget(analyst, agentId, true);
    const name = target.rosterAgent?.name ?? "DataClaw";
    if (!trimmed) throw new Error(`Tell ${name} what to do.`);
    if (trimmed.length > 20_000) throw new Error("That request is too long.");

    cancelAsk = false;
    const submission = await target.conversation.submit(
        {
            type: "input",
            content: trimmed,
            requestId: `ask:${crypto.randomUUID()}`,
        },
        analyst.context,
    );
    if (cancelAsk) await target.conversation.abort(analyst.context);
    return { submissionId: String(submission.id), agentId: target.agentId };
}

export async function abortMainAgent(agentId?: string): Promise<void> {
    cancelAsk = true;
    const analyst = await consoleHarness();
    const target = await resolveConsoleTarget(analyst, agentId, true);
    await target.conversation.abort(analyst.context);
    await releaseOrphanedSubmissions(analyst);
}

/**
 * A placed submission whose conversation has no live task will never be answered.
 * Abort leaves those in place, which keeps the console showing a run that cannot be stopped.
 */
async function releaseOrphanedSubmissions(analyst: AnalystHarness): Promise<void> {
    const inspection = await analyst.harness.inspect(analyst.context);
    const live = new Set(inspection.tasks.map((task) => String(task.record.conversationId)));
    const orphans = inspection.submissions.filter((submission) =>
        submission.status === "placed" && !live.has(String(submission.conversationId)));
    if (orphans.length === 0) return;
    await analyst.conversation.commit(async (tx) => {
        for (const submission of orphans) {
            const current = await tx.submission(submission.id);
            if (current?.status !== "placed") continue;
            tx.settleSubmission(submission.id, { status: "unanswered", reason: "aborted" });
        }
    }, analyst.context);
}

function submissionKeepsAgentBusy(
    submission: { status: string; conversationId: unknown },
    liveConversations: ReadonlySet<string>,
): boolean {
    if (submission.status === "queued") return true;
    return submission.status === "placed" && liveConversations.has(String(submission.conversationId));
}

export async function readWorkspace(
    analyst: AnalystHarness,
    options: { agentId?: string | undefined } = {},
): Promise<WorkspaceSnapshot> {
    const target = await resolveConsoleTarget(analyst, options.agentId);
    const conversationId = target.conversation.id;
    const [planState, findingsState, playbookState, rosterDoc, view, inspection] = await Promise.all([
        analyst.harness.documentState(AnalystPlanDoc, conversationId, analyst.context),
        analyst.harness.documentState(FindingsDoc, conversationId, analyst.context),
        analyst.harness.documentState(PlaybookDoc, conversationId, analyst.context),
        analyst.getRoster(),
        target.conversation.context(analyst.context),
        analyst.harness.inspect(analyst.context),
    ]);
    const plan = planState?.value;
    const findings = findingsState?.value;
    const playbook = playbookState?.value;

    const liveConversations = new Set(inspection.tasks.map((task) => String(task.record.conversationId)));
    const targetId = String(conversationId);
    const targetTasks = inspection.tasks.filter((task) => String(task.record.conversationId) === targetId);
    const working = targetTasks.length > 0
        || inspection.submissions.some((submission) =>
            String(submission.conversationId) === targetId
            && submissionKeepsAgentBusy(submission, liveConversations));

    const turns = buildTurns(view.messages);
    const turnRuns = turns.map((turn, index) => toRun(turn, working && index === turns.length - 1));
    const taskRuns = targetTasks.flatMap((task) => {
        const run = runFromTask(task.record.kind, task.record.input, task.record.startedAt, task.record.id, task.record.state);
        return run ? [run] : [];
    });

    const roster = rosterEntries(rosterDoc);
    const delegated = (rosterDoc?.runs ?? []).slice(-12).reverse().map((run) => runFromRoster(run));
    const runs = [...delegated, ...taskRuns, ...turnRuns.reverse()];
    const transcript = transcriptFrom(view.messages).slice(-150);
    const activity = activityFrom(transcript, plan?.goal);

    const sources = linkRuns([
        ...databricksSources(),
        ...await Promise.all(LOCAL_FILES.map(localFileSource)),
        documentSource("doc:plan", "Analyst plan", plan ? `${plan.hypotheses.length} hypotheses` : "No plan"),
        documentSource("doc:findings", "Findings", `${findings?.findings.length ?? 0} findings`),
        documentSource("doc:playbook", "Playbook", `v${playbook?.version ?? 1} · ${playbook?.heuristics.length ?? 0} heuristics`),
        documentSource("doc:roster", "Agent roster", `${roster.filter((agent) => agent.status === "active").length} specialists`),
    ], runs);

    const dataset = plan?.activeDataset
        ? `${plan.activeDataset.name} · ${plan.activeDataset.rowCount.toLocaleString()} rows`
        : undefined;

    const profile = target.rosterAgent ? normalizedAgentProfile(target.rosterAgent) : undefined;
    const model = target.rosterAgent?.model ?? analyst.selectedModel;

    return {
        agent: {
            id: target.rosterAgent?.id ?? "dataclaw",
            name: target.rosterAgent?.name ?? MAIN_AGENT_NAME,
            description: target.rosterAgent?.purpose ?? MAIN_AGENT_DESCRIPTION,
            status: working ? "Working" : "Ready",
            working,
            model: `${model.provider} / ${model.modelId}`,
            sources: target.rosterAgent && profile
                ? [
                    `${target.rosterAgent.role} specialist`,
                    `capabilities: ${formatCapabilities(profile.capabilities)}`,
                    ...(profile.contextFiles.length ? [`${profile.contextFiles.length} context file(s)`] : []),
                    ...(profile.skills.length ? [`skills: ${profile.skills.join(", ")}`] : []),
                ]
                : CAPABILITIES,
        },
        plan: {
            goal: plan?.goal ?? "Pending goal definition",
            status: plan?.status ?? "planning",
            milestone: plan?.currentMilestone ?? "Intake",
            hypothesisCount: plan?.hypotheses.length ?? 0,
            ...(dataset ? { dataset } : {}),
        },
        findingsCount: findings?.findings.length ?? 0,
        playbookVersion: playbook?.version ?? 1,
        heuristicCount: playbook?.heuristics.length ?? 0,
        roster,
        storagePath: analyst.storagePath,
        home: {
            path: analyst.workspaceDir,
            projectRoot: analyst.projectRoot,
            skills: await loadSkills({
                workspaceDir: analyst.workspaceDir,
                projectRoot: analyst.projectRoot,
            }),
        },
        sources,
        runs,
        transcript,
        activity,
        plugins: pluginsSummary(analyst.pluginTools, analyst.projectRoot),
    };
}

interface ConsoleTarget {
    conversation: AnalystHarness["conversation"];
    /** Empty string for the root coordinator. */
    agentId: string;
    rosterAgent?: RosterAgent;
}

/**
 * Resolve the conversation a console request is about. `dataclaw` (or nothing) is the root;
 * any other id must be an active roster agent. Read-only views fall back to the root so a
 * stale picker cannot break the page; an ask is strict and reports the missing agent.
 */
async function resolveConsoleTarget(
    analyst: AnalystHarness,
    agentId: string | undefined,
    strict = false,
): Promise<ConsoleTarget> {
    const requested = (agentId ?? "").trim();
    if (!requested || requested === "dataclaw" || requested === "main") {
        return { conversation: analyst.conversation, agentId: "" };
    }
    const roster = await analyst.getRoster();
    const agent = roster?.agents.find((item) => item.id === requested && item.status === "active");
    if (!agent || agent.conversationId <= 0) {
        if (strict) throw new Error(`No active agent with id "${requested}".`);
        return { conversation: analyst.conversation, agentId: "" };
    }
    const conversation = await analyst.harness.conversation(agent.conversationId as never, analyst.context);
    if (!conversation) {
        if (strict) throw new Error(`Agent "${agent.name}" has no conversation.`);
        return { conversation: analyst.conversation, agentId: "" };
    }
    return { conversation, agentId: agent.id, rosterAgent: agent };
}

export async function consoleWorkspace(agentId?: string): Promise<WorkspaceSnapshot> {
    try {
        return await readWorkspace(await consoleHarness(), { agentId });
    } catch (err) {
        resetConsoleHarness();
        return await readWorkspace(await consoleHarness(), { agentId });
    }
}

function databricksSources(): DataSource[] {
    const status = getDatabricksUiStatus();
    if (!status.connected) {
        return [{
            id: "databricks",
            name: "Databricks",
            type: "Databricks SQL MCP",
            status: "Warning",
            freshness: status.configured ? "Ready to connect" : "Auth required",
            records: status.error ? status.error.slice(0, 140) : "Not connected",
            agents: [MAIN_AGENT_NAME],
            runs: [],
        }];
    }

    const host = status.host ?? "Databricks";
    const sources: DataSource[] = [{
        id: "databricks",
        name: "Databricks",
        type: `${host} · SQL MCP`,
        status: "Connected",
        freshness: "Live",
        records: status.catalogs.length
            ? `${status.catalogs.length} catalogs${status.user ? ` · ${status.user}` : ""}`
            : status.user ?? "Connected",
        agents: [MAIN_AGENT_NAME],
        runs: [],
    }];

    for (const catalog of status.catalogs.slice(0, 24)) {
        sources.push({
            id: `catalog:${catalog}`,
            name: catalog,
            type: "Unity Catalog",
            status: "Connected",
            freshness: "Live",
            records: "Catalog",
            agents: [MAIN_AGENT_NAME],
            runs: [],
        });
    }
    return sources;
}

async function localFileSource(relativePath: string): Promise<DataSource> {
    const file = Bun.file(relativePath);
    const name = relativePath.split("/").pop() ?? relativePath;
    const exists = await file.exists();
    let records = "Missing";
    if (exists) {
        const text = await file.text();
        if (relativePath.endsWith(".json")) {
            try {
                const parsed = JSON.parse(text) as unknown;
                records = Array.isArray(parsed) ? `${parsed.length.toLocaleString()} rows` : "JSON document";
            } catch {
                records = "Unreadable JSON";
            }
        } else {
            const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
            records = `${Math.max(0, lines.length - 1).toLocaleString()} rows`;
        }
    }

    return {
        id: relativePath,
        name,
        type: relativePath.endsWith(".json") ? "Local JSON" : "Local CSV",
        status: exists ? "Healthy" : "Warning",
        freshness: exists ? "On disk" : "Missing",
        records,
        agents: [MAIN_AGENT_NAME],
        runs: [],
    };
}

function documentSource(id: string, name: string, records: string): DataSource {
    return {
        id,
        name,
        type: "Durable document",
        status: "Healthy",
        freshness: "SQLite",
        records,
        agents: [MAIN_AGENT_NAME],
        runs: [],
    };
}

function linkRuns(sources: DataSource[], runs: Run[]): DataSource[] {
    return sources.map((source) => ({
        ...source,
        runs: runs
            .filter((run) => run.dataSources.includes(source.name) || run.goal.includes(source.name))
            .map((run) => run.id),
    }));
}

interface BuiltTurn {
    goal: string;
    startedAt: number;
    endedAt: number;
    dataSources: string[];
    checkpoints: Checkpoint[];
    answer: string;
    error?: string;
    lastTool?: string;
}

export function buildTurns(messages: readonly unknown[]): BuiltTurn[] {
    const turns: BuiltTurn[] = [];
    let current: {
        goal: string;
        startedAt: number;
        endedAt: number;
        dataSources: Set<string>;
        checkpoints: Checkpoint[];
        answer: string;
        error?: string;
        lastTool?: string;
    } | undefined;

    const close = () => {
        if (!current) return;
        turns.push({
            goal: current.goal,
            startedAt: current.startedAt,
            endedAt: current.endedAt,
            dataSources: [...current.dataSources],
            checkpoints: current.checkpoints,
            answer: current.answer,
            ...(current.error ? { error: current.error } : {}),
            ...(current.lastTool ? { lastTool: current.lastTool } : {}),
        });
        current = undefined;
    };

    messages.forEach((message, index) => {
        const record = asRecord(message);
        if (!record) return;
        const role = typeof record.role === "string" ? record.role : "";
        const at = typeof record.timestamp === "number" ? record.timestamp : Date.now();
        if (role === "system") return;

        if (role === "user") {
            close();
            const goal = textFromContent(record.content) || "(empty turn)";
            current = {
                goal,
                startedAt: at,
                endedAt: at,
                dataSources: new Set(sourcesMentioned(goal)),
                checkpoints: [{
                    id: `ask-${index}`,
                    label: "Request",
                    timestamp: formatClock(at),
                    summary: goal.slice(0, 220),
                    state: "done",
                }],
                answer: "",
            };
            return;
        }

        if (!current) return;
        current.endedAt = at;

        if (role === "assistant") {
            for (const call of toolCallsFrom(record.content)) {
                for (const source of sourcesForTool(call.name, call.arguments)) current.dataSources.add(source);
                current.lastTool = call.name;
                current.checkpoints.push({
                    id: `tool-${index}-${current.checkpoints.length}`,
                    label: call.name,
                    timestamp: formatClock(at),
                    summary: call.summary,
                    state: "done",
                });
            }
            const text = textFromContent(record.content);
            if (text) current.answer = text;
            if (record.stopReason === "error" && typeof record.errorMessage === "string") {
                current.error = record.errorMessage;
            }
        }

        if (role === "toolResult") {
            if (isSyntheticMissingResult(record)) return;
            const name = typeof record.toolName === "string" ? record.toolName : "tool";
            const text = textFromContent(record.content);
            const checkpoint = [...current.checkpoints].reverse().find((item) => item.label === name);
            if (checkpoint && text) checkpoint.summary = text.slice(0, 220);
            if (text.startsWith("Failed") || text.includes("Error:")) current.error = text.slice(0, 280);
        }
    });

    close();
    return turns;
}

function toRun(turn: BuiltTurn, inFlight: boolean): Run {
    const failed = !inFlight && Boolean(turn.error) && !turn.answer;
    const checkpoints = turn.checkpoints.map((checkpoint, index) => ({
        ...checkpoint,
        state: inFlight && index === turn.checkpoints.length - 1 ? "current" as const : "done" as const,
    }));
    if (turn.answer && !inFlight) {
        checkpoints.push({
            id: `answer-${turn.startedAt}`,
            label: "Answer",
            timestamp: formatClock(turn.endedAt),
            summary: turn.answer.slice(0, 220),
            state: "done",
        });
    }

    return {
        id: `turn-${turn.startedAt}`,
        agentId: "dataclaw",
        goal: turn.goal,
        status: inFlight ? "Running" : failed ? "Failed" : "Completed",
        startedAt: formatWhen(turn.startedAt),
        duration: formatDuration(turn.startedAt, inFlight ? Date.now() : turn.endedAt),
        currentStep: inFlight ? (turn.lastTool ?? "Working") : failed ? "Failed" : "Answered",
        checkpoints,
        dataSources: turn.dataSources,
        event: turn.answer.slice(0, 180) || turn.error || (turn.lastTool ? `Called ${turn.lastTool}` : "Waiting for the model"),
        ...(failed && turn.error ? { error: turn.error } : {}),
    };
}

function runFromTask(
    kind: string,
    input: unknown,
    startedAt: number | undefined,
    id: unknown,
    state: { status: string; checkpoint?: unknown },
): Run | undefined {
    if (PI_TASKS.has(kind)) return undefined;
    const started = startedAt ?? Date.now();
    const phase = phaseOf(state);
    const dataSources: string[] = [];
    if (input && typeof input === "object" && "filePath" in input && typeof input.filePath === "string") {
        dataSources.push(input.filePath.split(/[/\\]/).pop() ?? input.filePath);
    }

    return {
        id: String(id),
        agentId: "dataclaw",
        goal: taskGoal(kind, input),
        status: "Running",
        startedAt: formatWhen(started),
        duration: formatDuration(started, Date.now()),
        currentStep: phase,
        checkpoints: [{
            id: `${String(id)}-phase`,
            label: phase,
            timestamp: formatClock(started),
            summary: kind,
            state: "current",
        }],
        dataSources,
        event: `${kind} is in progress`,
    };
}

function rosterEntries(roster: AgentRosterDocument | undefined): RosterEntry[] {
    const runs = roster?.runs ?? [];
    return (roster?.agents ?? []).map((agent) => {
        const profile = normalizedAgentProfile(agent);
        return {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            purpose: agent.purpose,
            status: agent.status,
            canManage: agent.canManage,
            working: runs.some((run) => run.agentId === agent.id && run.status === "running"),
            capabilities: [...profile.capabilities],
            contextFiles: [...profile.contextFiles],
            skills: [...profile.skills],
            hasBackground: profile.background.length > 0,
            compute: formatCompute(profile.compute),
            ...(agent.model ? { model: `${agent.model.provider}/${agent.model.modelId}` } : {}),
        };
    });
}

function runFromRoster(run: AgentRun): Run {
    const status = run.status === "running" ? "Running" : run.status === "failed" ? "Failed" : "Completed";
    const ended = run.finishedAt > 0 ? run.finishedAt : Date.now();
    return {
        id: run.id,
        agentId: run.agentId,
        goal: run.label,
        status,
        startedAt: formatWhen(run.startedAt),
        duration: formatDuration(run.startedAt, ended),
        currentStep: status === "Running" ? "Delegated" : status === "Failed" ? "Failed" : "Returned",
        checkpoints: [{
            id: `${run.id}-step`,
            label: run.mode === "session" ? "Session" : "Run",
            timestamp: formatClock(run.startedAt),
            summary: run.summary.slice(0, 220) || run.label,
            state: status === "Running" ? "current" : "done",
        }],
        dataSources: [],
        event: run.summary.slice(0, 180) || `${run.agentName} · ${run.mode}`,
        ...(status === "Failed" && run.summary ? { error: run.summary } : {}),
    };
}

function taskGoal(kind: string, input: unknown): string {
    const record = asRecord(input);
    if (typeof record?.targetQuestion === "string") return record.targetQuestion;
    if (kind === "analyst.auto_improvement") {
        return typeof record?.focusDomain === "string"
            ? `Improve the playbook: ${record.focusDomain}`
            : "Improve the playbook";
    }
    if (kind === "analyst.workflow") return "Analysis workflow";
    return kind;
}

function phaseOf(state: { status: string; checkpoint?: unknown }): string {
    const checkpoint = asRecord(state.checkpoint);
    if (typeof checkpoint?.phase === "string") return checkpoint.phase;
    return state.status;
}

export function isSyntheticMissingResult(record: Record<string, unknown>): boolean {
    const details = asRecord(record.details);
    if (details?.reason === "missing_result") return true;
    const text = textFromContent(record.content);
    return text.includes("Tool result unavailable: history ends before this call completed.");
}

export function transcriptFrom(messages: readonly unknown[]): TranscriptItem[] {
    const resultsByCallId = new Map<string, { toolName?: string; text: string; isError: boolean; durationMs?: number }>();
    for (const message of messages) {
        const record = asRecord(message);
        if (record && record.role === "toolResult" && typeof record.toolCallId === "string") {
            if (isSyntheticMissingResult(record)) continue;
            const text = textFromContent(record.content);
            resultsByCallId.set(record.toolCallId, {
                toolName: typeof record.toolName === "string" ? record.toolName : undefined,
                text,
                isError: Boolean(record.isError),
                durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
            });
        }
    }

    const consumedResultIds = new Set<string>();
    const items: TranscriptItem[] = [];

    messages.forEach((message, index) => {
        const record = asRecord(message);
        if (!record) return;
        const role = typeof record.role === "string" ? record.role : "";
        const time = formatClock(typeof record.timestamp === "number" ? record.timestamp : undefined);

        if (role === "user") {
            const text = textFromContent(record.content);
            if (text) items.push({ id: `user-${index}`, role: "user", text, time });
        } else if (role === "assistant") {
            const text = textFromContent(record.content);
            const thinking = thinkingFromContent(record.content);
            const failure = record.stopReason === "error" && typeof record.errorMessage === "string"
                ? record.errorMessage.trim()
                : "";

            const rawCalls = toolCallsFrom(record.content);
            const toolInvocations: ToolInvocation[] = rawCalls.map((call, cIdx) => {
                const callId = call.id || `call-${index}-${cIdx}`;
                const result = resultsByCallId.get(callId);
                if (result) consumedResultIds.add(callId);
                const status = !result ? "running" : result.isError ? "error" : "completed";
                return {
                    id: callId,
                    callId,
                    toolName: call.name,
                    summary: call.summary,
                    args: call.arguments,
                    status,
                    resultText: result?.text,
                    isError: result?.isError,
                    durationMs: result?.durationMs,
                    time,
                };
            });

            const hasTools = toolInvocations.length > 0;
            const shownText = text || (hasTools ? "" : failure);

            if (shownText || thinking || hasTools) {
                items.push({
                    id: `assistant-${index}`,
                    role: "assistant",
                    text: shownText,
                    thinking: thinking || undefined,
                    tools: hasTools ? toolInvocations : undefined,
                    time,
                });
            }
        } else if (role === "toolResult") {
            const callId = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
            if (callId && consumedResultIds.has(callId)) return;
            if (isSyntheticMissingResult(record)) return;
            const text = textFromContent(record.content);
            if (!text) return;
            items.push({
                id: `result-${index}`,
                role: "tool",
                ...(typeof record.toolName === "string" ? { toolName: record.toolName } : {}),
                toolCallId: callId,
                text,
                isError: Boolean(record.isError),
                durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
                time,
            });
        }
    });

    return items;
}

function activityFrom(transcript: TranscriptItem[], goal: string | undefined): ActivityItem[] {
    const items = [...transcript].reverse().slice(0, 6).map((item): ActivityItem => {
        const text = item.text
            || item.tools?.map((t) => `${t.toolName}: ${t.summary}`).join(", ")
            || (item.thinking ? "Thinking…" : "");
        return {
            kind: item.role === "user" ? "ask" : item.tools && !item.text ? "tool" : "answer",
            text: text.slice(0, 160),
            time: item.time || "Now",
        };
    });
    if (items.length === 0 && goal && goal !== "Pending goal definition") {
        items.push({ kind: "document", text: goal, time: "Plan" });
    }
    return items;
}

function sourcesMentioned(text: string): string[] {
    const found: string[] = [];
    if (text.includes("customer_churn.csv")) found.push("customer_churn.csv");
    if (text.includes("incident_logs.json")) found.push("incident_logs.json");
    if (/databricks|unity catalog/i.test(text)) found.push("Databricks");
    return found;
}

function sourcesForTool(name: string, args: unknown): string[] {
    const found: string[] = [];
    const record = asRecord(args);
    if (name === "profile_dataset" && typeof record?.filePath === "string") {
        found.push(record.filePath.split(/[/\\]/).pop() ?? record.filePath);
    }
    if (
        name === "connect_databricks"
        || name === "query_databricks"
        || name === "list_databricks_assets"
        || name === "profile_databricks_table"
    ) {
        found.push("Databricks");
    }
    if (typeof record?.table === "string") found.push(record.table);
    return found;
}

function toolCallsFrom(content: unknown): Array<{ id: string; name: string; summary: string; arguments: unknown }> {
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
        const record = asRecord(part);
        if (!record || record.type !== "toolCall" || typeof record.name !== "string") return [];
        return [{
            id: typeof record.id === "string" ? record.id : "",
            name: record.name,
            arguments: record.arguments,
            summary: summarizeToolArgs(record.name, record.arguments),
        }];
    });
}

function shortPath(path: string): string {
    const parts = path.split(/[/\\]/).filter(Boolean);
    const base = parts[parts.length - 1] ?? path;
    if (/^(SKILL|AGENTS|SOUL|IDENTITY|USER|CLAUDE)\.md$/i.test(base) && parts.length >= 2) {
        return `${parts[parts.length - 2]}/${base}`;
    }
    return base;
}

function summarizeToolArgs(name: string, args: unknown): string {
    const record = asRecord(args);
    if (!record) return name;
    if (name === "bash" && typeof record.command === "string") {
        const line = record.command.trim().split("\n")[0] ?? "";
        return line.slice(0, 120);
    }
    if ((name === "read" || name === "write" || name === "edit") && typeof record.path === "string") {
        return shortPath(record.path);
    }
    if (typeof record.sql === "string") {
        const line = record.sql.trim().split("\n")[0] ?? "";
        return line.slice(0, 120);
    }
    if (typeof record.command === "string") {
        const line = record.command.trim().split("\n")[0] ?? "";
        return line.slice(0, 120);
    }
    if (typeof record.filePath === "string") {
        return record.filePath.split(/[/\\]/).pop() ?? record.filePath;
    }
    if (name === "record_finding" && typeof record.title === "string") {
        return record.title.slice(0, 120);
    }
    if (name === "request_auditor_review" && typeof record.findingId === "string") {
        return `Audit ${record.findingId}`;
    }
    if (name === "manage_hypotheses") {
        const act = typeof record.action === "string" ? record.action : "manage";
        const id = typeof record.hypothesisId === "string" ? ` ${record.hypothesisId}` : "";
        return `${act}${id}`;
    }
    if (name === "list_databricks_assets") {
        return [record.action, record.catalog, record.schema].filter(Boolean).join(" · ") || "catalogs";
    }
    const interesting = record.title ?? record.statement ?? record.table ?? record.action ?? record.rationale ?? record.goal;
    if (typeof interesting === "string") return interesting.slice(0, 120);
    return name;
}

function thinkingFromContent(content: unknown): string {
    if (!Array.isArray(content)) return "";
    return content.flatMap((part) => {
        const record = asRecord(part);
        return record?.type === "thinking" && typeof record.thinking === "string" ? [record.thinking] : [];
    }).join("\n\n").trim();
}

function textFromContent(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content.flatMap((part) => {
        const record = asRecord(part);
        return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    }).join("\n").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function formatClock(timestamp: number | undefined): string {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatWhen(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatDuration(start: number, end: number): string {
    const total = Math.max(0, Math.round((end - start) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}
