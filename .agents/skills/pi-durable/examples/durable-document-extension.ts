import { defineDoc, defineExtension, defineTool, section, Harness } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

/**
 * 1. Define Typed Document Schema
 * Stored next to transcript in SQLite/storage and mutated in same atomic commit.
 */
export interface WorkLogDocument {
    currentMilestone: string;
    entries: Array<{ timestamp: number; note: string; author: string }>;
}

export const WorkLogDoc = defineDoc<WorkLogDocument>({
    kind: "project.worklog",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf", // Forked conversations start with values at that moment
    initial: () => ({
        currentMilestone: "Initial Exploration",
        entries: [],
    }),
});

/**
 * 2. Create Extension with System Prompt Injection & Modification Tools
 */
export const WorkLogExtension = defineExtension({
    name: "worklog",
    // Injected into system prompt before every model call
    sections: [
        section("current_worklog", async (input, context) => {
            const doc = await input.read.snapshot(WorkLogDoc, input.conversationId, context);
            if (!doc || doc.entries.length === 0) return undefined;

            const header = `Current Milestone: ${doc.currentMilestone}`;
            const logLines = doc.entries
                .slice(-5) // Last 5 entries
                .map((e) => `- [${new Date(e.timestamp).toISOString()}] (${e.author}): ${e.note}`)
                .join("\n");

            return `${header}\nRecent Work Log Entries:\n${logLines}`;
        }),
    ],
    tools: [
        defineTool({
            name: "log_progress",
            description: "Appends a progress note to the durable work log",
            parameters: Type.Object({
                note: Type.String({ description: "What was completed or discovered" }),
                author: Type.Optional(Type.String({ description: "Author name" })),
            }),
            replay: "safe",
            execute: async (args, api, context) => {
                await api.commit(async (tx) => {
                    const doc = await tx.doc(WorkLogDoc, api.conversationId);
                    doc.entries.push({
                        timestamp: Date.now(),
                        note: args.note,
                        author: args.author ?? "agent",
                    });
                }, context);

                return { content: [{ type: "text", text: `Logged: "${args.note}"` }] };
            },
        }),
        defineTool({
            name: "set_milestone",
            description: "Updates the current active milestone title",
            parameters: Type.Object({
                milestone: Type.String(),
            }),
            replay: "safe",
            execute: async (args, api, context) => {
                await api.commit(async (tx) => {
                    const doc = await tx.doc(WorkLogDoc, api.conversationId);
                    doc.currentMilestone = args.milestone;
                }, context);

                return { content: [{ type: "text", text: `Active milestone set to: ${args.milestone}` }] };
            },
        }),
    ],
});

/**
 * 3. Client UI Subscription Example
 */
export async function observeWorkLog(harness: Harness, conversationId: string) {
    const context = BACKGROUND_CONTEXT;
    const docState = await harness.documentState(WorkLogDoc, conversationId, context);

    if (docState) {
        console.log("Initial Milestone:", docState.value?.currentMilestone);

        // Reactively triggers whenever a tool or user mutates the document
        docState.subscribe((updated) => {
            console.log("\n[UI Update] Work Log Changed:");
            console.log(`Milestone: ${updated?.currentMilestone}`);
            console.log(`Total Entries: ${updated?.entries.length}`);
        });
    }
}
