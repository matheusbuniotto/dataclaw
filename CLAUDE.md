---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Data sources

Local CSV/JSON is loaded into an in-memory SQLite adapter. Every source — local, Databricks, or an
installed data-source plugin — sits behind `src/datasource/` (session, catalog, providers, dialects):

- `DataSourceRegistry.for(conversationId)` returns the conversation's session. Tools use only that;
  they never see an adapter, a transport or a dialect.
- `AnalystPlanDoc.dataSource` is the durable record (provider, dialect, host, endpoint, credential
  source, dataset, connectedAt). The session is its only writer. Never store tokens.
- A source is a manifest: `dataSource.dialect` plus the query/describe/inventory tools and a
  read-only mode. Adding one is a manifest and an MCP server; the fixture in
  `tests/fixtures/plugins/fake-snowflake-mcp/` proves no code change is needed.
- Dialects (`ansi`, `databricks`, `snowflake`, `bigquery`) own the SQL and fail closed with
  `dialect-missing` when a manifest names one that is not installed.
- `bun test` covers the session, the provider conformance suite, and the dialects; `bun run evals`
  exercises the whole agent path.

Databricks is attached as a read-only data source through its managed SQL MCP server:

- `.pi/mcp.json` registers the endpoint for pi sessions and subagents.
- Runtime code lives in `src/mcp/` (auth, transport, result decoding) and `src/adapters/databricks-adapter.ts`.
- Auth order: `DATABRICKS_HOST`/`DATABRICKS_TOKEN` env vars, then the `DATABRICKS_PROFILE`
  (default `DEFAULT`) section of `~/.databrickscfg` and `databricks auth token`.
- Never persist tokens in durable docs; `AnalystPlanDoc.databricks` stores only host/url/profile/warehouse.
- The console auth panel supports CLI profiles, browser OAuth (PKCE via the public `databricks-cli` client,
  callback `localhost:8020`), service-principal OAuth (client credentials, `sql` scope), and PATs.
  Server endpoints live under `/api/databricks/*`; see `src/console/api/databricks-api.ts`.
- Always use fully qualified `catalog.schema.table` names in Databricks SQL.
- Run `bun run cli databricks-status` to check the resolved workspace, and
  `bun run demo:databricks samples.nyctaxi.trips` for a live smoke test.

## Meta-agent and agent profiles

DataClaw is the meta-agent. Specialists are durable roster entries (`AgentRosterDoc`, version 2) with their own
conversation and a profile: `instructions` (persona), `background` + `contextFiles` (knowledge),
`skills`, `capabilities`, and an optional `model`.

- Capability names live in `src/docs/agent-capabilities.ts`: `analyst`, `databricks`, `coding`, `plugins`,
  `roster`, `features`, `all`, `plugin:<name>`, or explicit tool names. `resolveAgentCapabilities()` turns them
  into the extension list and tool allowlist a conversation is configured with.
- `agentConfiguration()` in `src/tools/agent-tools.ts` is the single place that builds the `pi.agent` change.
  `features_apply` reuses it after a plugin connects so existing agents pick up new tools.
- The `agent_profile` prompt section (`src/extensions/analyst-extension.ts`) injects background and knowledge
  files each turn; `available_skills` is filtered by the profile's `skills`. Read files with
  `loadAgentContextFiles()` in `src/workspace/context.ts`; paths are confined to the workspace/project.
- Fixed specialists (researcher, writer, reviewer) cannot be widened into managers. Only a coordinator or a
  custom agent with `roster`/`all` manages the roster.
- The console has one active-agent picker (`AgentPicker` in `DurableAgentConsole.tsx`, sidebar + chat header).
  `GET /api/workspace?agentId=...`, `/api/agent/ask` and `/api/agent/abort` all accept an `agentId`; the
  workspace snapshot is read from that agent's conversation. The UI keeps the choice in `?agent=<id>` and
  `localStorage`.

## Per-agent compute

`src/compute/agent-compute.ts` gives a specialist its own cwd. `compute.kind` is `shared`,
`local`, or `docker`; new agents default to `local`, migrated agents keep `shared`.

- `computeCwd()` is the single source of truth (`workspace/agents/<id>` for private compute).
  `agentConfiguration()` sets it as the conversation cwd; `ensureAgentCompute()` creates the
  home and `memory/` on create/update/reload.
- `src/compute/docker-env.ts` wraps a `NodeExecutionEnv`: file operations use the host side of
  the bind mount, while `exec` runs `docker exec` in a per-agent container. The home is mounted
  read-write at the same absolute path, the project root read-only, with cap-drop,
  no-new-privileges, memory/CPU/pid limits and `--network none` by default.
- `createAnalystHarness()` resolves the binding and roster in its `env` factory, so a docker
  agent gets the container environment. A failed Docker start logs and falls back to the local
  private home; it never prevents a turn.
- Scale-to-zero lives in `docker-env.ts`: a refcounted idle timer stops the container after
  `DATACLAW_COMPUTE_IDLE_MS` (default 15 min, `0` disables); `exec` wakes it with
  `ensureDockerContainer()` before every command. A once-per-project, once-per-process startup sweep stops
  leftover containers for that checkout (`DATACLAW_COMPUTE_SWEEP=off` disables). Containers are labeled
  `dataclaw.project` and named with a project hash, so parallel checkouts do not collide. Archive and a
  compute change away from Docker remove the container; the home remains on disk.
- The UI picker, roster prompt, `agents_inspect`, and CLI show each agent's compute. Compute
  homes are gitignored under `/workspace/agents/`.

## Self-extension

`src/tools/feature-tools.ts` lets the meta-agent add capabilities to itself:

- `features_create_skill` writes `workspace/skills/<name>/SKILL.md` (visible next turn, no reload).
- `features_create_plugin` writes `plugins/<name>/plugin.json` and optional source files. The plugin may be an
  MCP stdio server (its tools become `<plugin>__<tool>`) or a script transport (capability calls only).
- `features_apply` calls `FeatureRuntime.reload()` registered by `createAnalystHarness()`: it starts new plugins,
  swaps extensions in the live registry, uninstalls removed ones, and reconfigures roster agents. Old plugin
  clients stay alive until the harness closes, so an in-flight tool call cannot be cut off.
- `features_list`, `features_remove_skill`, and `features_remove_plugin` complete the loop. A plugin is only
  claimed as installed after `features_apply` returns its tools; a failed start is reported, not fatal.

## Data plugins

External programs provide versioned capabilities over MCP (stdio) or a JSON script; see
`docs/plugins.md` for the manifest, transports and contracts.

- Manifests live in `plugins/<name>/plugin.json` (gitignored), `dataclaw.plugins.json`, or
  `DATACLAW_PLUGIN_PATH`. `bun run plugins:list --check` shows them and starts each MCP server.
- `stats.compare_eval_runs@1` and `stats.agreement_kappa@1` feed `evals:compare` and
  `evals:calibrate score` through `resolveCapability()` in `src/plugins/registry.ts`.
- Every MCP plugin tool is also an agent tool named `<plugin>__<tool>`, registered in
  `src/plugins/agent-tools.ts` and installed by `src/harness.ts`. They are deferred behind
  `tool_search` and use `replay: "unsafe"`; a plugin that fails to start is skipped, not fatal.
  `createAnalystHarness({ pluginTools: false })` turns the bridge off.
- Report a plugin's `method` and `warnings` verbatim next to any number it produced.
- The console's Settings page lists them (`src/console/api/plugins-api.ts`, `GET /api/plugins`,
  `POST /api/plugins/check`); the snapshot field is `WorkspaceSnapshot.plugins`.
- `/prototype/capabilities` is the management page for plugins, skills, built-in tool groups and
  the Databricks MCP connection. Toggles persist to `dataclaw.capabilities.json` (gitignored,
  `src/capabilities/catalog.ts`), which the harness reads at startup, so the page and the agent
  agree; **Apply** closes and reopens the harness (`reloadConsoleHarness`) and is refused while a
  turn runs. Detach Databricks session listeners before closing a harness, or a late adapter
  connect commits to a closed session and kills the process.

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
