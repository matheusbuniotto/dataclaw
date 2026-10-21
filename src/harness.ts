import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness, type ConversationId, type EnvTarget } from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
import { getDefaultModelRef, setupModelsRegistry } from "./config";
import { DatabricksDataAdapter } from "./adapters/databricks-adapter";
import { databricksRecord } from "./datasource/providers/databricks";
import type { DatabricksConfigOverrides } from "./mcp/databricks-config";
import { MAIN_AGENT_INSTRUCTIONS } from "./agent/instructions";
import { setSharedAdapter } from "./tools/analyst-tools";
import { noteDatabricksAdapter } from "./tools/databricks-tools";
import { AnalystExtension } from "./extensions/analyst-extension";
import { AnalystPlanDoc } from "./docs/plan";
import { FindingsDoc } from "./docs/findings";
import { PlaybookDoc } from "./docs/playbook";
import { TelemetryDoc } from "./docs/telemetry";
import { AgentBindingDoc, AgentRosterDoc, type AgentRosterDocument } from "./docs/agents";
import { bindAgentWorkspace, ensureWorkspace, resolveWorkspaceDir } from "./workspace/context";
import { createPluginAgentTools, type PluginAgentTools } from "./plugins/agent-tools";
import { agentConfiguration } from "./tools/agent-tools";
import { ensureAgentCompute, normalizedCompute } from "./compute/agent-compute";
import { createDockerExecutionEnv, sweepDockerContainersOnce } from "./compute/docker-env";
import { setFeatureRuntime, type FeatureReloadResult } from "./features/runtime";
import { disabledPluginNames, readDisabled } from "./capabilities/catalog";

export interface CreateAnalystHarnessOptions {
    storagePath?: string;
    cwd?: string;
    /** Agent home. Defaults to `DATACLAW_WORKSPACE` or `<project>/workspace`. */
    workspaceDir?: string;
    /** Repo whose `.agents/skills` load after workspace skills. Defaults to the process cwd. */
    projectRoot?: string;
    fauxHandle?: FauxProviderHandle;
    model?: { provider: string; modelId: string };
    resume?: boolean;
    /**
     * Give the agent the tools of installed data plugins (docs/plugins.md). Default true;
     * `false` skips discovery entirely, so no plugin process starts. A plugin that fails to
     * start is reported and left out; it never keeps the harness from opening.
     */
    pluginTools?: boolean;
    /**
     * Connect a Databricks workspace through the managed SQL MCP server before
     * the first turn. `{}` uses env vars / the Databricks CLI profile.
     * Set DATABRICKS_AUTO_CONNECT=true to do this implicitly in the CLI.
     */
    databricks?: DatabricksConfigOverrides | boolean;
}

export async function createAnalystHarness(options: CreateAnalystHarnessOptions = {}) {
    const context = BACKGROUND_CONTEXT;
    const storagePath = options.storagePath ?? "./agent_analyst.sqlite";
    const projectRoot = options.projectRoot ?? options.cwd ?? process.cwd();
    const workspaceDir = resolveWorkspaceDir({
        ...(options.workspaceDir ? { workspaceDir: options.workspaceDir } : {}),
        projectRoot,
    });
    await ensureWorkspace(workspaceDir);

    // A previous process may have died with containers still running. Stop them once at
    // startup; they keep their homes and wake on the next turn. `DATACLAW_COMPUTE_SWEEP=off`
    // disables this for a shared host or a supervisor that owns the containers.
    void sweepDockerContainersOnce(projectRoot).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Docker compute sweep failed: ${message}`);
    });

    // What the console switched off: `dataclaw.capabilities.json` at the project root.
    const disabled = readDisabled(projectRoot).disabled;
    const disabledPlugins = disabledPluginNames(disabled);
    const disabledSkills = disabled.filter((id) => id.startsWith("skill:")).map((id) => id.slice("skill:".length));
    bindAgentWorkspace({ workspaceDir, projectRoot, disabledSkills });

    // 1. Configure Model Providers. Pi project settings override ~/.pi/agent.
    const pi = { projectRoot };
    const models = setupModelsRegistry({ fauxHandle: options.fauxHandle, ...pi });
    const selectedModel = options.model ?? getDefaultModelRef(pi);
    const opencode = selectedModel.provider === "opencode" || selectedModel.provider === "opencode-go";

    // 2. Configure Tool & Extension Registry
    const registry = createRegistry();
    // Core analyst tools always load: the console, the docs, and the audit flow depend on them.
    registry.install(AnalystExtension); // Domain profiling, SQL, hypotheses, audit, auto-improve
    if (!disabled.includes("tool:coding")) registry.install(CodingTools); // read, write, edit, bash

    // Installed data plugins become agent tools: one per MCP tool, named <plugin>__<tool>.
    // Deferred by default, so the model loads them through tool_search when a task needs them.
    const pluginsEnabled = options.pluginTools !== false;
    const pluginOptions = {
        root: projectRoot,
        disabled: disabledPlugins,
        onError: (message: string) => console.error(`data plugins: ${message}`),
    };
    const initialPluginTools = pluginsEnabled
        ? await createPluginAgentTools(pluginOptions)
        : undefined;
    let activePluginTools = initialPluginTools;
    const retiredPluginTools: PluginAgentTools[] = [];
    for (const extension of initialPluginTools?.extensions ?? []) registry.install(extension);
    if (initialPluginTools?.toolNames.length && initialPluginTools.deferred) registry.install(createToolSearchExtension());

    // 3. Execution Environment. A specialist with docker compute gets a per-agent container;
    // every other conversation gets the host environment at its cwd.
    const env = async ({ cwd, conversationId, read }: EnvTarget) => {
        const effectiveCwd = cwd ?? workspaceDir;
        const binding = await read.snapshot(AgentBindingDoc, conversationId, context);
        if (!binding?.agentId) return new NodeExecutionEnv({ cwd: effectiveCwd });
        const roster = await read.snapshot(AgentRosterDoc, context) as AgentRosterDocument | undefined;
        const agent = roster?.agents?.find((item) => item.id === binding.agentId);
        if (!agent) return new NodeExecutionEnv({ cwd: effectiveCwd });
        const compute = normalizedCompute(agent.compute);
        if (compute.kind !== "docker") return new NodeExecutionEnv({ cwd: effectiveCwd });
        try {
            return await createDockerExecutionEnv({
                agentId: agent.id,
                home: effectiveCwd,
                projectRoot,
                ...(compute.image ? { image: compute.image } : {}),
                ...(compute.network ? { network: compute.network } : {}),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Docker compute for ${agent.name} is unavailable; using local files at ${effectiveCwd}: ${message}`);
            return new NodeExecutionEnv({ cwd: effectiveCwd });
        }
    };

    // 4. Open Durable SQLite Harness
    const storage = await openNodeSqliteStorage(storagePath);
    const harness = await Harness.open(
        storage,
        {
            models,
            registry,
            env,
            settings: {
                compaction: {
                    reserveTokens: 8192,
                    backgroundTokens: 24576,
                },
                // OpenCode Go rejects requests that do not name the client and a session.
                // The harness supplies the session id; this names the client.
                ...(opencode
                    ? {
                        stream: {
                            headers: {
                                "x-opencode-client": "dataclaw",
                                "User-Agent": "dataclaw",
                            },
                        },
                    }
                    : {}),
            },
        },
        context,
    );

    // 5. Resume in-flight tasks from prior process executions
    if (options.resume !== false) {
        await harness.resume();
    }

    // 6. Connect to or initialize the root conversation
    const conversation = await harness.root(context, {
        agent: {
            model: selectedModel,
            cwd: workspaceDir,
            instructions: MAIN_AGENT_INSTRUCTIONS,
        },
    });

    // Existing roots keep their stored instructions until configure() replaces them.
    await conversation.configure({
        model: selectedModel,
        cwd: workspaceDir,
        instructions: MAIN_AGENT_INSTRUCTIONS,
    }, context);

    // 7. Ensure default documents are initialized in conversation
    await conversation.commit(async (tx) => {
        await tx.doc(AnalystPlanDoc, conversation.id);
        await tx.doc(FindingsDoc, conversation.id);
        await tx.doc(PlaybookDoc, conversation.id);
        await tx.doc(TelemetryDoc, conversation.id);
        await tx.doc(AgentRosterDoc);
        const binding = await tx.doc(AgentBindingDoc, conversation.id);
        if (!binding.agentId) binding.origin = "roster";
    }, context);

    // 8. Optionally attach Databricks as the data source via its managed SQL MCP server.
    // A failed connect leaves the agent up; the console can retry from the auth panel.
    const databricksRequested = options.databricks ?? (process.env.DATABRICKS_AUTO_CONNECT === "true");
    let databricksError: string | undefined;
    if (databricksRequested) {
        try {
            const overrides = typeof databricksRequested === "object" ? databricksRequested : {};
            const adapter = await DatabricksDataAdapter.connect(overrides);
            setSharedAdapter(adapter);
            noteDatabricksAdapter(adapter);

            await conversation.commit(async (tx) => {
                const plan = await tx.doc(AnalystPlanDoc, conversation.id);
                plan.dataSource = databricksRecord({
                    host: adapter.options.host ?? "unknown",
                    ...(adapter.options.mcpUrl ? { mcpUrl: adapter.options.mcpUrl } : {}),
                    ...(adapter.options.profile ? { profile: adapter.options.profile } : {}),
                });
                plan.updatedAt = Date.now();
            }, context);
        } catch (err) {
            databricksError = err instanceof Error ? err.message : String(err);
            console.error(`Databricks MCP connect failed: ${databricksError}`);
        }
    }

    // 9. Runtime self-extension: `features_apply` starts newly installed plugins, swaps their
    // extensions into the registry, and re-resolves roster profiles against the new tools.
    const reconfigureRosterAgents = async (): Promise<string[]> => {
        const roster = await harness.documentState(AgentRosterDoc, context);
        const doc = roster?.value as AgentRosterDocument | null | undefined;
        if (!doc) return [];
        const coordinator = await conversation.agent(context);
        const snapshot = registry.snapshot();
        const updated: string[] = [];
        for (const agent of doc.agents ?? []) {
            if (!agent.conversationId) continue;
            const child = await harness.conversation(agent.conversationId as ConversationId, context);
            if (!child) continue;
            await ensureAgentCompute(agent, workspaceDir);
            await child.configure(agentConfiguration(
                agent,
                coordinator.model,
                snapshot,
                agent.canManage ? "session" : "run",
                workspaceDir,
            ), context);
            updated.push(agent.id);
        }
        return updated;
    };

    const reloadFeatures = async (): Promise<FeatureReloadResult> => {
        if (!pluginsEnabled) {
            throw new Error("Plugin tools are disabled for this harness; set pluginTools: true to install plugins.");
        }
        const next = await createPluginAgentTools(pluginOptions);
        const previous = activePluginTools;
        const nextNames = new Set(next.extensions.map((extension) => extension.name));
        for (const extension of previous?.extensions ?? []) {
            if (!nextNames.has(extension.name)) registry.uninstall(extension);
        }
        for (const extension of next.extensions) registry.install(extension);
        if (next.toolNames.length && next.deferred && !registry.snapshot().extension("tool-search")) {
            registry.install(createToolSearchExtension());
        }
        // Keep the old clients alive until close: another tool call may still be running.
        if (previous) retiredPluginTools.push(previous);
        activePluginTools = next;
        const agentsUpdated = await reconfigureRosterAgents();
        return {
            plugins: next.plugins,
            errors: next.errors,
            agentsUpdated,
            toolNames: next.toolNames,
        };
    };

    setFeatureRuntime({
        projectRoot,
        workspaceDir,
        pluginToolNames: () => activePluginTools?.toolNames ?? [],
        pluginErrors: () => activePluginTools?.errors ?? [],
        reload: reloadFeatures,
    });

    return {
        harness,
        conversation,
        models,
        registry,
        context,
        storagePath,
        selectedModel,
        workspaceDir,
        projectRoot,
        databricksError,
        get pluginTools(): PluginAgentTools | undefined {
            return activePluginTools;
        },

        // Reload plugins and re-resolve every roster profile. The console and the
        // `features_apply` tool share this path.
        reloadFeatures,

        // Reactive document observation helpers
        async getPlan() {
            const state = await harness.documentState(AnalystPlanDoc, conversation.id, context);
            return state?.value;
        },
        async getFindings() {
            const state = await harness.documentState(FindingsDoc, conversation.id, context);
            return state?.value;
        },
        async getPlaybook() {
            const state = await harness.documentState(PlaybookDoc, conversation.id, context);
            return state?.value;
        },
        async getTelemetry() {
            const state = await harness.documentState(TelemetryDoc, conversation.id, context);
            return state?.value;
        },
        async getRoster() {
            const state = await harness.documentState(AgentRosterDoc, context);
            return state?.value;
        },

        async close() {
            setFeatureRuntime(undefined);
            await activePluginTools?.close();
            for (const retired of retiredPluginTools) {
                await retired.close().catch(() => undefined);
            }
            await harness.close(context);
        },
    };
}
