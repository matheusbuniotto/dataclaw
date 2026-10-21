# Tasks & Durability Engine

In Pi Durable, every piece of execution—whether an LLM request, a tool call, automatic compaction, or custom business logic—is modeled as a **durable task**.

---

## 1. Anatomy of `defineTask`

A task is a strongly typed state machine parameterized by:
1. `Input`: The input payload passed when creating the task.
2. `State`: A discriminated union representing the internal checkpoints/phases of the task.
3. `Result`: The output value returned when the task completes successfully.

```typescript
import { defineTask, type TaskId } from "@earendil-works/pi-durable";

interface BuildInput { commitHash: string }
type BuildState = 
    | { phase: "compile" }
    | { phase: "test"; artifactPath: string };

const BuildTask = defineTask<BuildInput, BuildState, { passed: boolean; artifacts: string }>({
    name: "ci.build",
    version: 1,
    initial: () => ({ phase: "compile" }),
    phases: {
        compile: async (task, runtime, context) => {
            // Step 1: Execute compilation
            const artifact = await compiler.compile(task.input.commitHash);

            // Commit checkpoint to transition to next phase
            await runtime.commit(() => ({
                status: "running",
                checkpoint: { phase: "test", artifactPath: artifact.path },
            }), context);
        },
        test: async (task, runtime, context) => {
            const { artifactPath } = task.state.checkpoint;
            const testResult = await testRunner.run(artifactPath);

            // Commit terminal outcome
            await runtime.commit(() => ({
                status: "terminal",
                outcome: testResult.success
                    ? { status: "completed", result: { passed: true, artifacts: artifactPath } }
                    : { status: "failed", error: { message: testResult.errorSummary } },
            }), context);
        },
    },
    abort: async (task, runtime, context) => {
        // Run compensation cleanup on cancellation
        await cleanupArtifacts(task.id);
        await runtime.commit(() => ({
            status: "terminal",
            outcome: { status: "aborted" },
        }), context);
    },
});
```

---

## 2. Phase Transitions & Commit Actions

When a task phase executes, it ends by committing an action via `runtime.commit(updater, context)`:

| Status | Return Shape | Meaning |
| :--- | :--- | :--- |
| **`running`** | `{ status: "running", checkpoint: NextState }` | Transitions to the next phase checkpoint. Resumed immediately by runtime. |
| **`waiting`** | `{ status: "waiting", checkpoint: NextState, on: TaskId[], policy: "failFast" \| "allSettled" }` | Pauses execution until referenced child tasks complete. Doesn't consume CPU/memory while waiting. |
| **`terminal`** | `{ status: "terminal", outcome: Outcome }` | Marks task finished (`completed`, `failed`, or `aborted`). Wakes parent tasks waiting on this task. |

### Outcome Types
- `{ status: "completed", result: T }`
- `{ status: "failed", error: { message: string, details?: any } }`
- `{ status: "aborted" }`

---

## 3. Waiting & Parallel Branching

A task can orchestrate multiple child tasks in parallel, waiting for all of them:

```typescript
phases: {
    startScanners: async (task, runtime, context) => {
        await runtime.commit(async (tx) => {
            const workers: TaskId<ScanResult>[] = [];
            for (const target of task.input.targets) {
                workers.push(
                    await tx.createTask(ScannerTask, { target }, {
                        ownership: { kind: "task", taskId: task.id },
                    }),
                );
            }
            return {
                status: "waiting",
                checkpoint: { phase: "aggregate", workers },
                on: workers,
                policy: "failFast", // If any worker fails or aborts, others are aborted immediately
            };
        }, context);
    },
    aggregate: async (task, runtime, context) => {
        const outcomes = await runtime.outcomes(task.state.checkpoint.workers, context);
        // Process results...
    },
}
```

---

## 4. Crash Recovery & Exactly-Once Semantics

### Deterministic Phase Idempotency
Because a host crash might happen during a phase, ensure external side-effects use deterministic keys derived from `task.id`:

```typescript
// Payment charge using idempotent task key
const receipt = await stripe.charges.create({
    amount: 5000,
    currency: "usd",
    idempotency_key: `charge-${task.id}`,
});
```

### Task Memos (`api.memo`)
Memos provide lightweight, crash-safe key-value checkpoints within hooks or tasks:
- **First write wins**: If a task wrote a memo before a crash, reading the memo after restart returns the previously written value.
- Prevents repeating expensive external questions or prompts.

```typescript
// Reading/writing memo in a hook
let approved = await api.memo<boolean>("approval:deploy", context);
if (approved === undefined) {
    const slackAnswer = await askHumanApproval(call);
    approved = await api.memo("approval:deploy", slackAnswer, context);
}
```

---

## 5. Ownership Tree & Abort Semantics

Every task and conversation exists within an ownership hierarchy:

```
Conversation (Root)
└── Task (Model Request Turn)
    └── Tool Call Task
        ├── Child Task A
        └── Child Subagent Conversation
```

### Ownership Policies
1. **`{ ownership: { kind: "task", taskId } }`**:
   - The child is strictly owned by the parent task.
   - If the parent task aborts, the child task and all of its descendants are aborted **bottom-up**.
   - The parent only completes after all children finish cleanup.
2. **`{ ownership: { kind: "conversation" } }`**:
   - The task belongs directly to the conversation.
3. **`{ ownership: { kind: "ownerless" } }`**:
   - Detached task/conversation (e.g., independent background audit).

### Foreground vs. Background Tasks
- **Foreground Tasks** (default): Part of the active conversation's turn. The conversation remains busy until finished. Pressing Esc / abort aborts them.
- **Background Tasks** (`{ background: true }`): The conversation becomes idle immediately while the task runs in the background. Ordinary conversation aborts do not affect it.
