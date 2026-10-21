import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { MAIN_AGENT_INSTRUCTIONS, MAIN_AGENT_NAME } from "../src/agent/instructions";
import { createAnalystHarness } from "../src/harness";
import { readWorkspace } from "../src/prototype/workspace";

test("the root conversation is the main data exploration agent", async () => {
    const faux = fauxProvider({
        provider: "faux",
        models: [{ id: "test-model", name: "Test model" }],
    });
    faux.setResponses([
        fauxAssistantMessage("I can explore local files and Databricks Unity Catalog over MCP."),
        fauxAssistantMessage("Still here."),
    ]);

    const projectRoot = await mkdtemp(join(tmpdir(), "dataclaw-agent-"));
    const analyst = await createAnalystHarness({
        storagePath: `:memory:`,
        resume: false,
        databricks: false,
        fauxHandle: faux,
        model: { provider: "faux", modelId: "test-model" },
        projectRoot,
        workspaceDir: join(projectRoot, "workspace"),
    });

    try {
        const configured = await analyst.conversation.agent(analyst.context);
        expect(configured.instructions).toContain("catalog.schema.table");
        expect(configured.instructions).toContain("connect_databricks");
        expect(configured.instructions).toBe(MAIN_AGENT_INSTRUCTIONS);

        const before = await readWorkspace(analyst);
        expect(before.agent.name).toBe(MAIN_AGENT_NAME);
        expect(before.agent.id).toBe("dataclaw");
        expect(before.runs.some((run) => run.id.startsWith("RUN-"))).toBe(false);

        await analyst.conversation.submit(
            {
                type: "input",
                content: "What can you explore?",
                requestId: "main-agent-turn",
            },
            analyst.context,
        );
        await analyst.conversation.waitForIdle(analyst.context);

        const after = await readWorkspace(analyst);
        expect(after.runs.some((run) => run.goal === "What can you explore?")).toBe(true);
        expect(after.transcript.some((item) => item.role === "user" && item.text === "What can you explore?")).toBe(true);
        expect(after.transcript.some((item) => item.role === "assistant" && item.text.includes("Unity Catalog"))).toBe(true);
        expect(after.agent.sources).toContain("Databricks MCP");
        expect(after.home.path).toBe(join(projectRoot, "workspace"));
        expect(after.home.skills.some((skill) => skill.name === "data-exploration")).toBe(true);
    } finally {
        await analyst.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});
