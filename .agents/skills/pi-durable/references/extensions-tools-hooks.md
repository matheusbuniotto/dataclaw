# Extensions, Tools & Lifecycle Hooks

In Pi Durable, agent capabilities are packaged into modular, hot-reloadable units called **Extensions**.

---

## 1. Extension Anatomy

An extension bundle is created with `defineExtension`:

```typescript
import { defineExtension, section } from "@earendil-works/pi-durable";

export const CodebaseContext = defineExtension({
    name: "codebase-context",
    sections: [
        // System prompt sections re-evaluated before every model turn
        section("git_status", async (input) => {
            const status = await input.env.exec("git status --short");
            return status.stdout.trim() || undefined;
        }),
    ],
    tools: [/* Tool definitions */],
    wraps: [/* Tool wrappers */],
    hooks: [/* Task lifecycle hooks */],
    tasks: [/* Custom task definitions */],
});
```

---

## 2. Defining Tools (`defineTool`)

Tools define parameter schemas using TypeBox (`@earendil-works/pi-ai`), execution handlers, and replay behavior:

```typescript
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

export const runTests = defineTool({
    name: "run_tests",
    description: "Run test suite with optional pattern filter",
    parameters: Type.Object({
        pattern: Type.Optional(Type.String()),
    }),
    replay: "safe", // Safe to rerun if server restarts mid-execution
    execute: async (args, api, context) => {
        // 1. Stream realtime output to all connected clients
        api.output(`Starting test run (pattern: ${args.pattern ?? "*"})...\n`);

        // 2. Execute process in conversation's environment
        const proc = await api.env.exec(`npm test -- ${args.pattern ?? ""}`);
        api.output(proc.stdout);

        return {
            content: [{
                type: "text",
                text: proc.exitCode === 0 ? "Tests passed." : `Tests failed:\n${proc.stderr}`,
            }],
        };
    },
});
```

### The Tool `api` Object
Inside `execute(args, api, context)`:
- `api.taskId`: The unique TaskId of this tool call.
- `api.conversationId`: The current conversation ID.
- `api.env`: The execution environment (`NodeExecutionEnv`, etc.).
- `api.output(chunk)`: Streams text/deltas to watching UI clients in realtime.
- `api.commit(tx => ...)`: Executes atomic transaction against storage.
- `api.createTask(taskDef, input, opts)`: Dispatches a subtask.
- `api.waitForTask(taskId)`: Awaits completion of a task.
- `api.details(metadata)`: Attaches structured metadata for UI renderers (e.g. subagent nesting).
- `api.memo(key, [val])`: Reads or persists a restart-safe value.

---

## 3. Tool Wrapping & Extension Precedence

Extensions can decorate existing tools installed by other extensions using `wrapTool`:

```typescript
import { wrapTool, defineExtension } from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";

export const TelemetryExtension = defineExtension({
    name: "telemetry",
    wraps: [
        wrapTool(createBashTool(), (bash) => ({
            ...bash,
            execute: async (args, api, context) => {
                const start = performance.now();
                try {
                    return await bash.execute(args, api, context);
                } finally {
                    metrics.timing("tool.bash.duration", performance.now() - start);
                }
            },
        })),
    ],
});
```

### Overriding Tools
- If a later extension defines a tool with the same `name` as an earlier extension, the later tool **replaces** the earlier one.
- Wrapped tools always decorate whichever tool implementation was selected by name.

---

## 4. Lifecycle Hooks (`hook`)

Hooks allow extensions to intercept built-in tasks:
- `ToolTask`: Tool execution lifecycle.
- `ModelTask`: LLM request/response lifecycle.
- `CompactionTask`: Context reduction lifecycle.

```typescript
import { hook, ToolTask, defineExtension } from "@earendil-works/pi-durable";

export const SecurityPolicy = defineExtension({
    name: "security-policy",
    hooks: [
        hook(ToolTask, {
            // Before tool runs: inspect, rewrite arguments, or block
            beforeTool: async (call, api, context) => {
                if (call.name === "bash" && call.args.command.includes("rm -rf /")) {
                    return { block: "Destructive command blocked by security policy." };
                }

                // Can also rewrite arguments
                if (call.name === "read_file" && call.args.path.startsWith("/etc/")) {
                    return { block: "Access to system directory /etc/ forbidden." };
                }

                return undefined; // Allow execution to proceed
            },

            // After tool runs: inspect or mutate result
            afterTool: async (call, result, api, context) => {
                // Redact sensitive patterns from tool output
                return sanitizeSecrets(result);
            },
        }),
    ],
});
```

### Hook Chaining Rules
- Hooks run in the order extensions are activated.
- In `beforeTool`: First hook returning `{ block: string }` immediately stops execution.
- If a hook throws an unhandled error in `beforeTool`, the tool call is blocked. In other phases, the error is recorded and subsequent hooks continue.

---

## 5. Malleability: Runtime Hot-Reloading

Extensions and tools can be hot-reloaded dynamically while conversations are running:

```typescript
// Reload extension from disk on file change
watcher.on("change", async (path) => {
    const updated = await loadExtension(path);
    // Overwrites existing extension by name in a single atomic registry update
    registry.install(updated);
});
```

- In-flight tool calls finish using the code version they started with.
- Subsequent calls immediately use the newly installed code.
- Transcripts store extension and tool **names**, not serialized code, ensuring reloads and restarts cleanly bind to current code.
