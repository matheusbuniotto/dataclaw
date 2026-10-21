import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
import { getDefaultModelRef, setupModelsRegistry } from "./config";
import { DatabricksDataAdapter } from "./adapters/databricks-adapter";
import type { DatabricksConfigOverrides } from "./mcp/databricks-config";
import { MAIN_AGENT_INSTRUCTIONS } from "./agent/instructions";
import { setSharedAdapter } from "./tools/analyst-tools";
import { noteDatabricksAdapter } from "./tools/databricks-tools";
import { AnalystExtension } from "./extensions/analyst-extension";
import { AnalystPlanDoc } from "./docs/plan";
import { FindingsDoc } from "./docs/findings";
import { PlaybookDoc } from "./docs/playbook";
import { TelemetryDoc } from "./docs/telemetry";
import { bindAgentWorkspace, ensureWorkspace, resolveWorkspaceDir } from "./workspace/context";
import { createPluginAgentTools } from "./plugins/agent-tools";
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
    const pluginTools = options.pluginTools === false
        ? undefined
        : await createPluginAgentTools({
            root: projectRoot,
            disabled: disabledPlugins,
            onError: (message) => console.error(`data plugins: ${message}`),
        });
    for (const extension of pluginTools?.extensions ?? []) registry.install(extension);
    if (pluginTools?.toolNames.length && pluginTools.deferred) registry.install(createToolSearchExtension());

    // 3. Execution Environment
    const env = ({ cwd }: { cwd?: string }) =>
        new NodeExecutionEnv({ cwd: cwd ?? workspaceDir });

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
                plan.databricks = {
                    host: adapter.options.host ?? "unknown",
                    mcpUrl: adapter.options.mcpUrl ?? "",
                    ...(adapter.options.profile ? { profile: adapter.options.profile } : {}),
                    ...(adapter.options.warehouseId ? { warehouseId: adapter.options.warehouseId } : {}),
                    connectedAt: Date.now(),
                };
                plan.updatedAt = Date.now();
            }, context);
        } catch (err) {
            databricksError = err instanceof Error ? err.message : String(err);
            console.error(`Databricks MCP connect failed: ${databricksError}`);
        }
    }

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
        pluginTools,

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

        async close() {
            await pluginTools?.close();
            await harness.close(context);
        },
    };
}
