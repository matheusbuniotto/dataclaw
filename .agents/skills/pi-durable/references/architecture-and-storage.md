# Pi Durable Architecture & Storage Backends

This document details the storage architecture, process isolation, memory model, and execution environments in Pi Durable (`@earendil-works/pi-durable`).

---

## 1. Storage Interface & Concurrency Model

Pi Durable separates the agent runtime engine from storage persistence. The storage layer uses a clean, minimal interface that models transcripts, tasks, documents, and memos as atomic transactional operations.

### Storage Backends
Pi Durable ships with three built-in backends:
1. **Node SQLite (`@earendil-works/pi-durable/storage/sqlite/node`)**:
   - Production-ready for local workstations, servers, and containerized deployments.
   - Uses write-ahead logging (WAL) for concurrent read access.
2. **In-Memory (`MemoryStorage`)**:
   - Zero-disk footprint, fast turnaround for unit tests and ephemeral scratch sessions.
3. **JSONL Storage (`JsonlStorage`)**:
   - Append-only human-readable ledger suitable for audit-heavy or append-only log pipelines.

### Edge Runtimes (Bun & Cloudflare Durable Objects)
The core SQLite and JSONL implementations deliberately omit Node-specific runtime bindings (`fs`, `net`). With a minimal shim:
- **Cloudflare Durable Objects**: Run an entire harness inside a Durable Object instance. Storage maps to DO SQL storage (`ctx.storage.sql`). Single-process ownership naturally matches Cloudflare DO actor concurrency guarantees.
- **Bun**: Runs using `bun:sqlite` with near-zero adaptation.

### Single-Writer Process Ownership
- Exactly **one process** owns and writes to a storage backend instance at a time.
- External clients (TUIs, web frontends, API servers, Slack connectors) attach to the owning process via RPC, WebSocket, or IPC channels to stream deltas and send submissions.

---

## 2. Working Set & Context Window Memory Model

Traditional agents either keep everything in memory (crashing on long conversations) or suffer severe latency by loading full message histories on every prompt.

Pi Durable solves this through **bounded working sets**:
1. **On SQLite**: Only active transcripts, in-flight tasks, and pending submissions are kept in memory.
2. **Dormant History on Disk**: Historical turns, completed tasks, and cold documents remain stored in SQLite pages and are loaded on-demand (e.g. during replay or deep search).
3. **Natural Bounding via Compaction**: Because background compaction automatically summarizes older turns when approaching context limits (`contextWindow - reserveTokens`), active transcripts never balloon out of control. A conversation spanning tens of thousands of messages maintains a compact working memory footprint (< 100MB).

---

## 3. Execution Environments (`env`)

Tools require access to files, processes, and terminal environments. In Pi Durable, execution environments are decoupled from the host running the harness.

### Scoping Execution per Conversation
The `env` factory receives context from the conversation (such as its working directory `cwd`) and instantiates an execution environment:

```typescript
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

const env = ({ cwd }: { cwd?: string }) => {
    return new NodeExecutionEnv({
        cwd: cwd ?? process.cwd(),
        env: { ...process.env, CI: "true" },
    });
};
```

### Remote & Sandboxed Execution
Because tools interact with the environment through an abstract interface (`readFile`, `writeFile`, `exec`, `listDir`), you can replace `NodeExecutionEnv` with:
- **Docker / Podman Sandbox**: Per-conversation isolated containers.
- **SSH / Remote VM**: Run the agent harness on a lightweight server while bash tools execute on an internal build machine or staging server.
- **MicroVM (Firecracker / Fly.io / Modal)**: Ephemeral environments for running untrusted code.

---

## 4. Harness Configuration & Lifecycle

```typescript
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const context = BACKGROUND_CONTEXT;

const harness = await Harness.open(
    await openNodeSqliteStorage("./agent.sqlite"),
    {
        models,
        registry,
        env,
        settings: {
            compaction: {
                reserveTokens: 16384,     // Token buffer reserved for response
                backgroundTokens: 32768,  // Start background compaction threshold
            },
        },
    },
    context,
);

// Graceful shutdown
await harness.close(context);
```
