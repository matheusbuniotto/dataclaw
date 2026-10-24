import { describeDatabricksConfig } from "../../mcp/databricks-config";
import { createAnalystHarness } from "../../harness";
import { MAIN_AGENT_DESCRIPTION, MAIN_AGENT_NAME } from "../../agent/instructions";
import { DatabricksDataAdapter } from "../../adapters/databricks-adapter";
import { databricksRecord } from "../../datasource/providers/databricks";
import { bridgedProvider } from "../../datasource/providers/bridged";
import { databricksDialect } from "../../datasource/dialects";
import { readDisabled } from "../../capabilities/catalog";
import { AnalystPlanDoc } from "../../docs/plan";
import { FindingsDoc } from "../../docs/findings";
import { PlaybookDoc } from "../../docs/playbook";
import { TelemetryDoc } from "../../docs/telemetry";
import { generateMarkdownReport, generateHtmlReport, generateJsonReport } from "../../docs/report-generator";
import {
    adoptDatabricksAdapter,
    connectDatabricks,
    getDatabricksUiStatus,
    recordDatabricksAuthError,
    subscribeDatabricks,
} from "./databricks-api";
import { loadSkills } from "../../workspace/context";
import type { AgentRosterDocument, AgentRun, RosterAgent } from "../../docs/agents";
import { normalizedAgentProfile } from "../../docs/agents";
import { formatCapabilities } from "../../docs/agent-capabilities";
import { toolDeclaration, type ToolSummary } from "../../tools/inventory";
import { formatCompute } from "../../compute/agent-compute";
import {
    asRecord,
    isTranscript,
    parseTranscript,
    type Transcript,
    type TranscriptEvent,
    type TranscriptToolResult,
    type TranscriptTurn,
} from "../../transcript";
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
} from "../state/workspace-types";

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
    } else if (process.env.DATABRICKS_CLIENT_ID && process.env.DATABRICKS_CLIENT_SECRET && process.env.DATABRICKS_HOST) {
        // Databricks Apps Service Principal auto-connection (M2M OAuth)
        void connectDatabricks({
            host: process.env.DATABRICKS_HOST,
            warehouseId: process.env.DATABRICKS_WAREHOUSE_ID,
            oauth: {
                clientId: process.env.DATABRICKS_CLIENT_ID,
                clientSecret: process.env.DATABRICKS_CLIENT_SECRET,
            },
        }).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            recordDatabricksAuthError(message);
            console.error(`Databricks Apps Service Principal connect failed: ${message}`);
        });
    }

    return analyst;
}

/**
 * The console's auth panel owns its Databricks connection (OAuth refresh, status, catalogs). Hand
 * the adapter to the session as a provider, so the agent and the panel share one live source.
 */
async function rememberDatabricks(analyst: AnalystHarness, adapter: DatabricksDataAdapter): Promise<void> {
    const host = adapter.options.host ?? "unknown";
    // The adapter may finish connecting after a capability reload closed this harness.
    await (async () => {
        const plan = await analyst.getPlan();
        const sameWorkspace = plan?.dataSource?.host === host;
        await analyst.dataSources.attach(
            analyst.conversation.id,
            bridgedProvider("databricks", databricksDialect, adapter),
            databricksRecord({
                host,
                ...(adapter.options.mcpUrl ? { mcpUrl: adapter.options.mcpUrl } : {}),
                ...(adapter.options.profile ? { profile: adapter.options.profile } : {}),
                connectedAt: sameWorkspace ? plan?.dataSource?.connectedAt ?? Date.now() : Date.now(),
            }),
        );
    })().catch((err: unknown) => {
        console.error(`could not record the Databricks session: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function forgetDatabricks(analyst: AnalystHarness): Promise<void> {
    await analyst.dataSources.disconnect(analyst.conversation.id).catch((err: unknown) => {
        console.error(`could not clear the Databricks session: ${err instanceof Error ? err.message : String(err)}`);
    });
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
            const current = await (tx as any).submission(submission.id);
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

    // One parse answers both questions the console asks about the conversation.
    const parsed = parseTranscript(view.messages);
    const turns = buildTurns(parsed);
    const turnRuns = turns.map((turn, index) => toRun(turn, working && index === turns.length - 1));
    const taskRuns = targetTasks.flatMap((task) => {
        const run = runFromTask(task.record.kind, task.record.input, task.record.startedAt, task.record.id, task.record.state);
        return run ? [run] : [];
    });

    const roster = rosterEntries(rosterDoc);
    const delegated = (rosterDoc?.runs ?? []).slice(-12).reverse().map((run) => runFromRoster(run));
    const runs = [...delegated, ...taskRuns, ...turnRuns.reverse()];
    const transcript = transcriptFrom(parsed).slice(-150);
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
        plugins: pluginsSummary(analyst.pluginTools, analyst.projectRoot, readDisabled(analyst.projectRoot).disabled),
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

/** The console's data-source card: what can be connected, and what is live for this agent. */
export async function consoleDataSources(agentId?: string): Promise<{
    providers: import("../../datasource/session").ProviderDescriptor[];
    status: import("../../datasource/types").SourceStatus;
}> {
    const analyst = await consoleHarness();
    const target = await resolveConsoleTarget(analyst, agentId);
    return {
        providers: analyst.dataSources.providers(),
        status: analyst.dataSources.for(target.conversation.id).status(),
    };
}

/** The live plugin summary, so /api/plugins and /api/capabilities describe plugins the same way. */
export async function consolePlugins(): Promise<ReturnType<typeof pluginsSummary>> {
    const analyst = await consoleHarness();
    return pluginsSummary(analyst.pluginTools, analyst.projectRoot, readDisabled(analyst.projectRoot).disabled);
}

export async function consoleWorkspace(agentId?: string): Promise<WorkspaceSnapshot> {
    try {
        return await readWorkspace(await consoleHarness(), { agentId });
    } catch (err) {
        resetConsoleHarness();
        return await readWorkspace(await consoleHarness(), { agentId });
    }
}

export async function consoleReport(format: string = "json", agentId?: string): Promise<Record<string, unknown>> {
    const analyst = await consoleHarness();
    const target = await resolveConsoleTarget(analyst, agentId);
    const conversationId = target.conversation.id;

    const [planState, findingsState, playbookState, telemetryState] = await Promise.all([
        analyst.harness.documentState(AnalystPlanDoc, conversationId, analyst.context),
        analyst.harness.documentState(FindingsDoc, conversationId, analyst.context),
        analyst.harness.documentState(PlaybookDoc, conversationId, analyst.context),
        analyst.harness.documentState(TelemetryDoc, conversationId, analyst.context),
    ]);

    const input = {
        plan: planState?.value,
        findings: findingsState?.value,
        playbook: playbookState?.value,
        telemetry: telemetryState?.value,
        agentName: target.rosterAgent?.name ?? MAIN_AGENT_NAME,
    };

    if (format === "html") {
        return { format: "html", content: generateHtmlReport(input) };
    }
    if (format === "md" || format === "markdown") {
        return { format: "markdown", content: generateMarkdownReport(input) };
    }
    return { format: "json", report: generateJsonReport(input) };
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
    return sources.map((source) => {
        // Tool arguments name a provider id ("databricks"); the card's name is "Databricks".
        const name = source.name.toLowerCase();
        return {
            ...source,
            runs: runs
                .filter((run) => run.dataSources.some((value) => value.toLowerCase() === name)
                    || run.goal.toLowerCase().includes(name))
                .map((run) => run.id),
        };
    });
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

/** Turns of a conversation, for the run list. Accepts messages or a transcript parsed once. */
export function buildTurns(input: readonly unknown[] | Transcript): BuiltTurn[] {
    const transcript = isTranscript(input) ? input : parseTranscript(input);
    return transcript.turns.map(turnFrom);
}

function turnFrom(turn: TranscriptTurn): BuiltTurn {
    const startedAt = turn.timestamp ?? Date.now();
    const goal = turn.text || "(empty turn)";
    const dataSources = new Set(sourcesMentioned(goal));
    const checkpoints: Checkpoint[] = [{
        id: `ask-${turn.index}`,
        label: "Request",
        timestamp: formatClock(startedAt),
        summary: goal.slice(0, 220),
        state: "done",
    }];
    let endedAt = startedAt;
    let answer = "";
    let error: string | undefined;
    let lastTool: string | undefined;

    for (const event of turn.events) {
        endedAt = event.timestamp ?? endedAt;

        if (event.kind === "toolCall") {
            for (const source of sourcesForTool(event.toolName, event.args)) dataSources.add(source);
            lastTool = event.toolName;
            const checkpoint: Checkpoint = {
                id: `tool-${event.index}-${checkpoints.length}`,
                label: event.toolName,
                timestamp: formatClock(event.timestamp),
                summary: summarizeToolArgs(event.toolName, event.args),
                state: "done",
            };
            checkpoints.push(checkpoint);
            if (event.result) applyResult(checkpoint, event.result);
        } else if (event.kind === "toolResult") {
            // A result with no call in the transcript still lands on the last step of its name.
            const name = event.result.toolName ?? "tool";
            const checkpoint = [...checkpoints].reverse().find((item) => item.label === name);
            if (checkpoint) applyResult(checkpoint, event.result);
        } else if (event.kind === "assistantText") {
            answer = event.text;
        } else if (event.kind === "stop" && event.stopReason === "error" && event.errorMessage !== undefined) {
            error = event.errorMessage;
        }

        const failure = eventFailure(event);
        if (failure) error = failure;
    }

    return {
        goal,
        startedAt,
        endedAt,
        dataSources: [...dataSources],
        checkpoints,
        answer,
        ...(error ? { error } : {}),
        ...(lastTool ? { lastTool } : {}),
    };
}

function applyResult(checkpoint: Checkpoint, result: TranscriptToolResult): void {
    if (result.text) checkpoint.summary = result.text.slice(0, 220);
}

/** A tool result that reads as a failure, in the words the tools use. */
function eventFailure(event: TranscriptEvent): string | undefined {
    const text = event.kind === "toolCall" ? event.result?.text : event.kind === "toolResult" ? event.result.text : undefined;
    if (!text) return undefined;
    return text.startsWith("Failed") || text.includes("Error:") ? text.slice(0, 280) : undefined;
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

function rosterEntries(roster: AgentRosterDocument | Readonly<AgentRosterDocument> | null | undefined): RosterEntry[] {
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

/** The console's transcript items, projected from the events of one parse. */
export function transcriptFrom(input: readonly unknown[] | Transcript): TranscriptItem[] {
    const transcript = isTranscript(input) ? input : parseTranscript(input);
    const items: TranscriptItem[] = [];
    let assistant: {
        index: number;
        item: TranscriptItem;
        tools: ToolInvocation[];
        text: string;
        thinking: string;
        failure: string;
    } | undefined;

    const flush = () => {
        if (!assistant) return;
        const shownText = assistant.text || (assistant.tools.length > 0 ? "" : assistant.failure);
        if (shownText || assistant.thinking || assistant.tools.length > 0) {
            items.push({
                ...assistant.item,
                text: shownText,
                thinking: assistant.thinking || undefined,
                tools: assistant.tools.length > 0 ? assistant.tools : undefined,
            });
        }
        assistant = undefined;
    };

    for (const event of transcript.events) {
        if (event.kind === "turnStart") {
            flush();
            // Always an item, even with empty text: the run list counts the turn either way.
            items.push({ id: `user-${event.index}`, role: "user", text: event.text, time: formatClock(event.timestamp) });
            continue;
        }

        if (event.kind === "toolResult") {
            flush();
            if (!event.result.text) continue;
            items.push({
                id: `result-${event.index}`,
                role: "tool",
                ...(event.result.toolName ? { toolName: event.result.toolName } : {}),
                ...(event.result.callId ? { toolCallId: event.result.callId } : {}),
                text: event.result.text,
                toolStatus: event.result.isError ? "error" : "completed",
                isError: event.result.isError,
                durationMs: event.result.durationMs,
                time: formatClock(event.timestamp),
            });
            continue;
        }

        // Every event of one assistant message belongs to one item, so they share an index.
        if (!assistant || assistant.index !== event.index) {
            flush();
            assistant = {
                index: event.index,
                item: { id: `assistant-${event.index}`, role: "assistant", text: "", time: formatClock(event.timestamp) },
                tools: [],
                text: "",
                thinking: "",
                failure: "",
            };
        }

        if (event.kind === "assistantText") assistant.text = event.text;
        else if (event.kind === "assistantThinking") assistant.thinking = event.text;
        else if (event.kind === "toolCall") assistant.tools.push(toolInvocationFrom(event));
        else if (event.kind === "stop" && event.stopReason === "error" && event.errorMessage !== undefined) {
            assistant.failure = event.errorMessage.trim();
        }
    }

    flush();
    return items;
}

/** A call event as the console's tool card: paired results decide the status. */
function toolInvocationFrom(event: Extract<TranscriptEvent, { kind: "toolCall" }>): ToolInvocation {
    const result = event.result;
    return {
        id: event.callId,
        callId: event.callId,
        toolName: event.toolName,
        summary: summarizeToolArgs(event.toolName, event.args),
        args: event.args,
        status: !result ? "running" : result.isError ? "error" : "completed",
        resultText: result?.text,
        isError: result?.isError,
        durationMs: result?.durationMs,
        time: formatClock(event.timestamp),
    };
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
    const record = asRecord(args);
    if (!record) return [];
    const found: string[] = [];
    for (const source of toolDeclaration(name)?.sources ?? []) {
        const value = record[source.key];
        if (typeof value !== "string") continue;
        found.push(source.shape === "path" ? value.split(/[/\\]/).pop() ?? value : value);
    }
    // Whatever the tool, a call that names a dataset or a table touched it.
    if (typeof record.dataset === "string") found.push(record.dataset);
    if (typeof record.table === "string") found.push(record.table);
    return found;
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
    const summary = toolDeclaration(name)?.summary;
    if (summary) return summarizeDeclared(name, record, summary);
    // Undeclared tools (plugins, tool_search) and declared ones without a hint: the first
    // argument that names the call.
    for (const key of ["sql", "command"]) {
        if (typeof record[key] === "string") return clipLine(record[key] as string);
    }
    if (typeof record.filePath === "string") return record.filePath.split(/[/\\]/).pop() ?? record.filePath;
    const interesting = record.title ?? record.statement ?? record.table ?? record.action ?? record.rationale ?? record.goal;
    return typeof interesting === "string" ? interesting.slice(0, 120) : name;
}

function clipLine(value: string): string {
    return (value.trim().split("\n")[0] ?? "").slice(0, 120);
}

function summarizeDeclared(name: string, record: Record<string, unknown>, summary: ToolSummary): string {
    const parts: string[] = [];
    for (const key of summary.keys) {
        const value = record[key];
        if (typeof value !== "string" || !value.trim()) continue;
        parts.push(summary.shape === "line" ? clipLine(value)
            : summary.shape === "path" ? shortPath(value)
                : value);
    }
    if (parts.length === 0) return summary.fallback ?? name;
    return `${summary.prefix ?? ""}${parts.join(summary.join ?? " ")}`.slice(0, 120);
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
