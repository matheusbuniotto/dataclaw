import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

async function main() {
    const context = BACKGROUND_CONTEXT;

    // 1. Initialize models
    const models = createModels();
    models.setProvider(openaiProvider());

    // 2. Set up tool registry
    const registry = createRegistry();
    registry.install(CodingTools); // Built-in read, write, edit, bash

    // 3. Define execution environment factory (Node.js local filesystem & bash)
    const env = ({ cwd }: { cwd?: string }) =>
        new NodeExecutionEnv({ cwd: cwd ?? process.cwd() });

    // 4. Open SQLite harness
    const storagePath = "./agent_workspace.sqlite";
    const harness = await Harness.open(
        await openNodeSqliteStorage(storagePath),
        { models, registry, env },
        context,
    );

    // 5. Resume any unfinished tasks from previous process runs
    await harness.resume();

    // 6. Connect to or initialize the root conversation
    const root = await harness.root(context, {
        agent: {
            model: { provider: "openai", modelId: "gpt-6.1-sol" },
            cwd: process.cwd(),
        },
    });

    console.log("Root conversation online. Submitting prompt...");

    // 7. Submit a prompt with an idempotent request ID
    const submission = await root.submit(
        {
            type: "input",
            content: "Check git status and summarize modified files.",
            requestId: "req-init-check",
        },
        context,
    );

    const result = await submission.wait(context);
    console.log("Response completed:", result.answer);

    await harness.close(context);
}

main().catch(console.error);
