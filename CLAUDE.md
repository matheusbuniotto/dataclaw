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

Local CSV/JSON is loaded into an in-memory SQLite adapter. Databricks is attached as a
read-only data source through its managed SQL MCP server:

- `.pi/mcp.json` registers the endpoint for pi sessions and subagents.
- Runtime code lives in `src/mcp/` (auth, transport, result decoding) and `src/adapters/databricks-adapter.ts`.
- Auth order: `DATABRICKS_HOST`/`DATABRICKS_TOKEN` env vars, then the `DATABRICKS_PROFILE`
  (default `DEFAULT`) section of `~/.databrickscfg` and `databricks auth token`.
- Never persist tokens in durable docs; `AnalystPlanDoc.databricks` stores only host/url/profile/warehouse.
- The console auth panel supports CLI profiles, browser OAuth (PKCE via the public `databricks-cli` client,
  callback `localhost:8020`), service-principal OAuth (client credentials, `sql` scope), and PATs.
  Server endpoints live under `/api/databricks/*`; see `src/prototype/databricks-api.ts`.
- Always use fully qualified `catalog.schema.table` names in Databricks SQL.
- Run `bun run cli databricks-status` to check the resolved workspace, and
  `bun run demo:databricks samples.nyctaxi.trips` for a live smoke test.

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
- The console's Settings page lists them (`src/prototype/plugins-api.ts`, `GET /api/plugins`,
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
