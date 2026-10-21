import { Type } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, configure, defineTool, defineExtension } from "@earendil-works/pi-durable";

/**
 * Subagent Tool Pattern:
 * A tool that spawns a dedicated subagent conversation owned by the calling task.
 * If the process crashes mid-execution, replaying this tool finds the existing
 * subagent conversation and continues waiting for its answer without duplicating work.
 */
export const codeReviewerTool = defineTool({
    name: "request_code_review",
    description: "Spawns a specialized code review subagent to critique a patch",
    parameters: Type.Object({
        diff: Type.String({ description: "Git diff to review" }),
    }),
    replay: "safe", // Safe to reconnect after crash
    execute: async (args, api, context) => {
        // 1. Atomically get or create the child subagent conversation
        const childConvId = await api.commit(async (tx) => {
            const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
            if (existing !== undefined) return existing.id;

            // Create conversation owned strictly by this tool task
            const created = await tx.createConversation({
                ownership: { kind: "task", taskId: api.taskId },
            });

            // Configure subagent with a smaller, specialized model and no tools
            await configure(tx, created.id, {
                model: { provider: "openai", modelId: "gpt-6-luna" },
                tools: [],
                instructions: 
                    "You are a strict security and code quality reviewer. " +
                    "Analyze the diff and return bullet points with any bugs or security vulnerabilities.",
            });

            return created.id;
        }, context);

        // 2. Report subagent conversation ID to UI for hierarchical rendering
        await api.details({ conversationId: childConvId }, context);

        // 3. Obtain subagent conversation handle
        const subagent = await api.conversation(childConvId, context);
        if (!subagent) {
            throw new Error(`Failed to load subagent conversation: ${childConvId}`);
        }

        // 4. Submit review request with deterministic ID based on calling taskId
        const submission = await subagent.submit(
            {
                type: "input",
                content: args.diff,
                requestId: `review-subagent:${api.taskId}`,
            },
            context,
        );

        // 5. Await subagent completion
        const settled = await submission.wait(context);

        // 6. Read subagent's answer from transcript
        const entry = await api.commit(
            (tx) => tx.entry(AssistantEntry, settled.answer!),
            context,
        );

        const message = entry?.model?.[0] as AssistantMessage | undefined;
        const reviewText = message?.content
            ?.flatMap((c) => (c.type === "text" ? [c.text] : []))
            .join("") ?? "No review returned.";

        return {
            content: [{ type: "text", text: reviewText }],
        };
    },
});

export const CodeReviewExtension = defineExtension({
    name: "code-review",
    tools: [codeReviewerTool],
});
