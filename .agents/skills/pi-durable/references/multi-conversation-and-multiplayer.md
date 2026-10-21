# Multi-Conversation, Multiplayer & Durable Documents

This guide covers advanced agent patterns in Pi Durable (`@earendil-works/pi-durable`): transcript branching, multiplayer UI synchronization, active steering, and atomic document state.

---

## 1. Multi-Conversation Branching (Forking)

In collaborative or asynchronous agent workflows, multiple conversations often branch from a common point (such as a root channel with thread replies, or speculative execution branches).

### Non-Copying Branching
When a conversation forks, it references the parent transcript up to that specific entry without copying data:

```typescript
const question = await channel.submit({
    type: "input",
    content: "Analyze the database migration error",
}, context);
const answered = await question.wait(context);

// Fork a new conversation off the specific answer entry
const thread = await channel.fork(
    answered.answer!,
    { ownership: { kind: "ownerless" } },
    context,
);

// Fork can configure different models or restrictive tools
await thread.configure({
    tools: { remove: ["drop_table", "migrate_db"] },
}, context);
```

---

## 2. Multiplayer UI & Realtime Streaming

Pi Durable enables multiple human operators and automated bots to monitor and steer the same agent simultaneously.

### Reactive View State (`viewState`)
A client (web dashboard, terminal UI) connects and receives the current snapshot plus subsequent real-time changes:

```typescript
const view = await conversation.viewState(context);

// Render initial view
renderUI(view.value);

// Listen to incremental delta changes
const unsubscribe = view.subscribe((updatedView) => {
    renderUI(updatedView);
});
```

### Watching Low-Level Commits vs. High-Level Events
- **`conversation.watch()`**: Emits exact atomic storage commits over WebSocket. Highly efficient and compact.
- **`conversation.watchEvents()`**: Translates commits into standard agent event streams (`tool_started`, `model_delta`, `tool_finished`) for traditional UI integrations.

### Active In-Flight Steering (`whenBusy: "steer"`)
Users can interrupt or redirect an agent mid-turn without canceling the whole session:

```typescript
// Submits a steering prompt that is injected immediately after current tool call completes
await conversation.submit(
    {
        type: "input",
        content: "Stop searching docs and check the local package.json instead",
        whenBusy: "steer",
    },
    context,
);
```

---

## 3. Durable Documents (`defineDoc`)

Applications built on top of agents often require shared state—such as Kanban task lists, architectural plans, or sandbox manifests—that must survive crashes alongside the agent's conversation.

### Defining Typed Documents

```typescript
import { defineDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

export interface PlanDocument {
    steps: { id: string; title: string; done: boolean }[];
}

export const PlanDoc = defineDoc<PlanDocument>({
    kind: "project.plan",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf", // Forked conversations inherit parent's plan as of the fork point
    initial: () => ({ steps: [] }),
});

export const PlanningExtension = defineExtension({
    name: "planning",
    // 1. Inject plan into model system prompt before every turn
    sections: [
        section("project_plan", async (input, context) => {
            const plan = await input.read.snapshot(PlanDoc, input.conversationId, context);
            if (!plan?.steps.length) return undefined;
            return plan.steps
                .map((s) => `[${s.done ? "X" : " "}] ${s.title}`)
                .join("\n");
        }),
    ],
    // 2. Tool to update plan atomically
    tools: [
        defineTool({
            name: "update_plan_step",
            description: "Mark a plan step as completed or add a new step",
            parameters: Type.Object({
                title: Type.String(),
                done: Type.Boolean(),
            }),
            execute: async (args, api, context) => {
                await api.commit(async (tx) => {
                    const plan = await tx.doc(PlanDoc, api.conversationId);
                    const existing = plan.steps.find((s) => s.title === args.title);
                    if (existing) {
                        existing.done = args.done;
                    } else {
                        plan.steps.push({ id: crypto.randomUUID(), title: args.title, done: args.done });
                    }
                }, context);

                return { content: [{ type: "text", text: `Updated step: ${args.title}` }] };
            },
        }),
    ],
});
```

### Document UI Subscriptions
External interfaces can observe document state in real-time:

```typescript
const planState = await harness.documentState(PlanDoc, conversation.id, context);
planState?.subscribe((currentPlan) => {
    updateKanbanBoard(currentPlan?.steps ?? []);
});
```

---

## 4. Context Compaction & Self-Handoff Pattern

When conversations span thousands of lines:

### Automated Background Compaction
Configured at harness initialization:
```typescript
settings: {
    compaction: {
        reserveTokens: 16384,     // Headroom reserved for completion
        backgroundTokens: 32768,  // Starts background summarization when limit approached
    },
}
```

### Self-Handoff with Searchable History
Agents can reset their context window using a clean handoff note while preserving complete search access to previous messages:

```typescript
export const searchHistoryTool = defineTool({
    name: "search_history",
    description: "Search previous entries before a context handoff",
    parameters: Type.Object({ query: Type.String() }),
    replay: "safe",
    execute: async (args, api, context) => {
        const page = await api.commit(
            (tx) => tx.scanEntries({ conversationId: api.conversationId }, 100),
            context,
        );
        const matches = page.items.filter((entry) =>
            JSON.stringify(entry.model ?? []).includes(args.query),
        );
        return {
            content: [{
                type: "text",
                text: matches.length > 0 
                    ? matches.map((m) => JSON.stringify(m.model)).join("\n")
                    : "No matching history found.",
            }],
        };
    },
});
```
