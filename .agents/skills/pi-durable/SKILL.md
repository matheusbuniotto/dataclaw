---
name: pi-durable
description: >-
  Architect, build, and troubleshoot long-running, crash-resilient, and malleable AI agents using Earendil's Pi Durable framework (@earendil-works/pi-durable). Use this skill when designing agent harnesses, implementing crash survival and task resumption, configuring durable storage backends (SQLite, memory, Cloudflare Durable Objects), writing durable task state machines, managing multi-conversation forking, building subagents, or implementing real-time multiplayer agent interfaces.
---

# Pi Durable: Resilient & Malleable Agent Harness Guide

Pi Durable (`@earendil-works/pi-durable`) is an experimental agent framework from Earendil designed for building long-running, durable, and malleable agents that can run anywhere (Node.js, Bun, Cloudflare Durable Objects, remote VMs). 

Unlike traditional agent loops that die when a process terminates, Pi Durable treats every model turn, tool call, compaction run, and custom business workflow as an explicitly checkpointed, durable task stored in an atomic persistence backend.

---

## 1. Mental Model & Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │                        HARNESS                         │
                    │  Storage (SQLite / Memory / JSONL / KV / Cloudflare DO)│
                    │  Models Registry (@earendil-works/pi-ai)               │
                    │  Extensions Registry (Tools, Hooks, Tasks, Sections)   │
                    └──────────────────────────┬─────────────────────────────┘
                                               │
                   ┌───────────────────────────┴────────────────────────────┐
                   │                                                        │
          ┌────────▼────────┐                                      ┌────────▼────────┐
          │  Conversation 1 │ (Root Channel)                       │  Conversation 2 │ (Fork / Thread)
          │  - Agent Config │                                      │  - Agent Config │
          │  - Transcript   │                                      │  - Shared Tree  │
          │  - Execution Env│ (Node / Remote VM)                   │  - Execution Env│
          └────────┬────────┘                                      └─────────────────┘
                   │
         ┌─────────┴──────────────────────────────────────┐
         │ Tasks & Ownership Tree                         │
         ├───────────────────────┬────────────────────────┤
         │ Model Turn Task       │ Tool Task (replayable) │
         │ Custom Workflow Task  │ Subagent Conversation  │
         │ Background Compaction │ Durable Document State │
         └───────────────────────┴────────────────────────┘
```

### Core Abstractions

| Concept | Purpose |
| :--- | :--- |
| **Harness** | The runtime container managing storage, parallel conversations, extension registry, and execution environments. Single-writer process ownership. |
| **Conversation** | An interaction transcript between user/system and an agent. Can fork from any point without copying history. |
| **Agent** | The LLM configuration for a conversation: provider, model ID, thinking level, selected extensions, active tools, and prompt additions. |
| **Execution Environment (`env`)** | Where tools execute file and process operations (local laptop `NodeExecutionEnv`, remote VM, or sandbox). Scoped per-conversation `cwd`. |
| **Task** | The fundamental unit of work. Every model call, tool invocation, compaction, or multi-step workflow is a checkpointed, resumable state machine. |
| **Extension** | A hot-swappable bundle of prompt `sections`, `tools`, `wraps`, `hooks`, and custom `tasks`. |
| **Document (`Doc`)** | Typed application state (e.g., todos, tickets, plans) stored alongside transcript and modified in the same atomic transaction. |

---

## 2. Quickstart Harness Bootstrap

```typescript
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

const context = BACKGROUND_CONTEXT;

// 1. Configure Model Providers
const models = createModels();
models.setProvider(openaiProvider());

// 2. Install Tools & Extensions in Registry
const registry = createRegistry();
registry.install(CodingTools); // read, write, edit, bash

// 3. Define Per-Conversation Execution Environment
const env = ({ cwd }: { cwd?: string }) =>
    new NodeExecutionEnv({ cwd: cwd ?? process.cwd() });

// 4. Open Durable Harness over SQLite Storage
const harness = await Harness.open(
    await openNodeSqliteStorage("./agent.sqlite"),
    { models, registry, env },
    context,
);

// 5. Open or Reconnect to Root Conversation
const root = await harness.root(context, {
    agent: {
        model: { provider: "openai", modelId: "gpt-6.1-sol" },
        cwd: process.cwd(),
    },
});

// 6. Submit a Prompt with Idempotent Request ID
const submission = await root.submit(
    {
        type: "input",
        content: "Refactor auth middleware and run tests",
        requestId: "job-001",
    },
    context,
);

const result = await submission.wait(context);
```

---

## 3. Crash Recovery & Durability Rules

### Resuming After Failures
When a host crashes, restarts, or loses power:
1. Re-open the storage: `const harness = await Harness.open(storage, options, context);`
2. Invoke `harness.resume()` to find unfinished tasks and resume them from their latest checkpoints.
3. Use a deterministic `requestId` on submissions. Retrying an identical `requestId` returns the original submission rather than re-running.

```typescript
// Resumption entry point
harness.resume();
const root = await harness.root(context);
const settled = await (await root.submit(job, context)).wait(context);
```

### Tool Replay Policies
Tools must explicitly declare their replay safety:

```typescript
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

// SAFE REPLAY: Read-only or idempotent operations rerun automatically after crash
const searchCode = defineTool({
    name: "search_code",
    description: "Search symbols across repo",
    parameters: Type.Object({ query: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
        api.output(`Searching for ${args.query}...\n`);
        return { content: [{ type: "text", text: await index.search(args.query) }] };
    },
});

// UNSAFE REPLAY: Mutating/external side-effects are NEVER automatically repeated
const deployRelease = defineTool({
    name: "deploy_release",
    description: "Deploy artifact to cluster",
    parameters: Type.Object({ tag: Type.String() }),
    // Omitting replay (or non-safe) ensures interrupted call is reported as
    // interrupted to the model with partial output, letting model decide next steps.
    execute: async (args) => ({
        content: [{ type: "text", text: await cluster.deploy(args.tag) }],
    }),
});
```

---

## 4. Durable Tasks & Workflows

Custom multi-phase workflows (like checkouts, deployments, batch code audits) are written as typed state machines using `defineTask`.

```typescript
import { defineTask, type TaskId } from "@earendil-works/pi-durable";

interface AuditInput { files: string[] }
type AuditState = 
    | { phase: "analyze" }
    | { phase: "review"; workers: TaskId<string>[] };

const AuditTask = defineTask<AuditInput, AuditState, string>({
    name: "repo.audit",
    version: 1,
    initial: () => ({ phase: "analyze" }),
    phases: {
        analyze: async (task, runtime, context) => {
            await runtime.commit(async (tx) => {
                const workers: TaskId<string>[] = [];
                for (const file of task.input.files) {
                    workers.push(
                        await tx.createTask(FileWorkerTask, { file }, {
                            ownership: { kind: "task", taskId: task.id },
                        }),
                    );
                }
                return {
                    status: "waiting",
                    checkpoint: { phase: "review", workers },
                    on: workers,
                    policy: "failFast", // Fail immediately if any subtask fails
                };
            }, context);
        },
        review: async (task, runtime, context) => {
            const outcomes = await runtime.outcomes(task.state.checkpoint.workers, context);
            const allPassed = outcomes.every((o) => o.status === "completed");
            await runtime.commit(() => ({
                status: "terminal",
                outcome: allPassed
                    ? { status: "completed", result: "All files passed audit." }
                    : { status: "failed", error: { message: "Violations found." } },
            }), context);
        },
    },
    abort: async (task, runtime, context) => {
        // Compensation logic run on cancellation
        await runtime.commit(() => ({
            status: "terminal",
            outcome: { status: "aborted" },
        }), context);
    },
});
```

### Task Ownership & Cancellation
- **Task Tree**: Ownership is strictly hierarchical. Canceling a task aborts all children bottom-up.
- **Foreground Tasks**: Owned by `api.taskId`. Active conversation waits for them. User interrupt (Esc / abort) cancels them.
- **Background Tasks**: Owned by `conversation` with `{ background: true }`. Run independently while conversation becomes idle; unaffected by ordinary turn aborts.

---

## 5. Subagents: Clean & Durable

In Pi Durable, subagents do not require heavy frameworks. A subagent is simply an isolated conversation owned by a tool task:

```typescript
import { Type } from "@earendil-works/pi-ai";
import { AssistantEntry, configure, defineTool } from "@earendil-works/pi-durable";

export const delegateResearch = defineTool({
    name: "delegate_research",
    description: "Delegate in-depth documentation or code exploration to a subagent",
    parameters: Type.Object({ topic: Type.String() }),
    replay: "safe", // Re-attaches to the same subagent and submission upon restart
    execute: async (args, api, context) => {
        const childId = await api.commit(async (tx) => {
            const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
            if (existing) return existing.id;

            // Create subagent owned by this tool call
            const sub = await tx.createConversation({
                ownership: { kind: "task", taskId: api.taskId },
            });

            await configure(tx, sub.id, {
                model: { provider: "openai", modelId: "gpt-6-luna" },
                tools: ["read_file", "search_code"],
                instructions: "You are a concise research subagent. Answer with facts only.",
            });
            return sub.id;
        }, context);

        // Expose to UI nesting
        await api.details({ conversationId: childId }, context);

        const subagent = await api.conversation(childId, context);
        const settled = await (await subagent!.submit({
            type: "input",
            content: args.topic,
            requestId: `subagent:${api.taskId}`,
        }, context)).wait(context);

        const entry = await api.commit(
            (tx) => tx.entry(AssistantEntry, settled.answer!),
            context,
        );
        const text = entry?.model?.[0]?.content
            ?.flatMap((c: any) => c.type === "text" ? [c.text] : [])
            .join("") ?? "";

        return { content: [{ type: "text", text }] };
    },
});
```

---

## 6. Multi-Conversation Forking & Realtime Multiplayer

### Forking Transcripts
A conversation can fork at any historical entry without copying storage. Ideal for thread replies (Slack/Discord) or parallel what-if exploration:

```typescript
const answered = await channel.submit({ type: "input", content: "Should we deploy?" }, context);
const result = await answered.wait(context);

// Fork a thread at the agent's answer
const thread = await channel.fork(
    result.answer!,
    { ownership: { kind: "ownerless" } },
    context,
);

// Both proceed concurrently without blocking each other
await Promise.all([
    thread.submit({ type: "input", content: "What are the rollback risks?" }, context),
    channel.submit({ type: "input", content: "Who is on call?" }, context),
]);
```

### Live Steering & Multiplayer UI
Multiple users/clients can connect to the same conversation concurrently:
- **`thread.viewState(context)`**: Retrieve current snapshot + subscribe to reactive deltas.
- **`whenBusy: "steer"`**: Inject guidance into a busy agent immediately after the currently executing tool call without aborting the entire turn.

```typescript
// Steer an in-flight conversation
await thread.submit(
    {
        type: "input",
        content: "Skip the integration tests and run unit tests only",
        whenBusy: "steer",
    },
    context,
);
```

---

## 7. Compaction, Handoffs, and Search

Pi Durable handles large context windows gracefully without stopping the agent:
1. **Background Compaction**: Summarizes older turns in the background when approaching context limits (`backgroundTokens`, `reserveTokens`).
2. **Context Handoff**: `reset()` or `{ control: { handoff: note } }` clears working context while preserving complete historical searchability via `search_history`.

```typescript
// Tool enabling agent to self-handoff when context is bloated
const handoffTool = defineTool({
    name: "handoff",
    description: "Start fresh context with a summary handoff note.",
    parameters: Type.Object({ note: Type.String() }),
    execute: async (args, api, context) => {
        const self = await api.conversation(api.conversationId, context);
        await self!.submit({
            type: "input",
            content: "Continue with the task using the handoff note.",
            requestId: `handoff:${api.taskId}`,
        }, context);

        return {
            content: [{ type: "text", text: "Handoff initiated." }],
            control: { handoff: args.note },
        };
    },
});
```

---

## 8. Reference Directory Index

Deep-dive documentation and specialized patterns are organized in [references/](./references/):

- [Architecture & Storage Backends](./references/architecture-and-storage.md): Concurrency model, SQLite paging, Cloudflare Durable Objects adapters, execution environment sandboxing.
- [Tasks & Durability Engine](./references/tasks-and-durability.md): Deep-dive into `defineTask`, phase commits, idempotency, memoization with `api.memo()`, and failure fast policies.
- [Extensions, Tools & Hooks](./references/extensions-tools-hooks.md): Dynamic prompt sections, tool wrapping (`wrapTool`), interceptor hooks (`beforeTool`, `afterTool`, `onYield`), hot-reloading extensions.
- [Multi-Conversation & Multiplayer](./references/multi-conversation-and-multiplayer.md): Transcript forking, ownership models, reactive state subscriptions (`viewState`, `watch`), and active steering.

### Working Examples

- [Basic Harness Setup](./examples/basic-harness.ts): Standard harness with SQLite, coding tools, and models.
- [Subagent Worker Tool](./examples/subagent-pattern.ts): Crash-safe subagent with transcript inspection and UI metadata.
- [Durable Task Saga Workflow](./examples/durable-task-saga.ts): Parallel task execution with compensation abort.
- [Durable Document Extension](./examples/durable-document-extension.ts): Shared reactive state using `defineDoc`.
