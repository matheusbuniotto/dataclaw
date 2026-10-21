# 01 · Put the live data source behind one seam

**Status:** `accepted` · **Strength:** Strong · **Seam:** ports & adapters · **Size:** L

Explored with the design-it-twice pass on 2026-10-21, extended to cover adding new data MCPs
(Snowflake, BigQuery, and later sources). Accepted 2026-10-21; implementation steps are in
[01-plan.md](01-plan.md).

## Problem

Which adapter is live is kept in two module globals plus a durable field on `AnalystPlanDoc`, and
four modules must write all of them together. The tools read it as a process-wide singleton, so the
console, an eval run, and any test in the same process share one slot. The adapter interface also
does not cover aborting a query: one implementation duck-types it, the other is typed against the
concrete class.

And the arrangement does not generalise: Databricks is wired in as a special case in the tools, the
prompt, the plan document, the console and the auth panel. Adding Snowflake the same way would add
four more tools, a fourth copy of the connection record, and a second bespoke MCP client.

## Evidence

| Where | What |
| --- | --- |
| `src/tools/analyst-tools.ts:12` | `sharedAdapter` module global; `setSharedAdapter`, `releaseSharedAdapter`, `getSharedAdapter` (`:43`, no callers) |
| `src/tools/analyst-tools.ts:21` | `bindAbort` probes for an optional `bindSignal` by shape |
| `src/tools/databricks-tools.ts:9–10` | `activeDatabricks`, `lastReconnectAttempt` — a second global for the same adapter |
| `src/tools/databricks-tools.ts:37` | `requireDatabricks` reconnects from `AnalystPlanDoc` in the middle of a tool call |
| `src/prototype/databricks-api.ts:65` | `connection` — a third copy of the live adapter |
| `src/adapters/databricks-adapter.ts:137` | `bindSignal` stores the signal in a mutable instance field: two concurrent tool calls trade signals |
| `src/harness.ts:201`, `src/prototype/workspace.ts:136`, `src/tools/databricks-tools.ts:68,146` | four paired writes: `setSharedAdapter` + `noteDatabricksAdapter` |
| `src/harness.ts:205`, `src/tools/databricks-tools.ts:150`, `src/prototype/workspace.ts:148` | `plan.databricks` written three ways; the console preserves `connectedAt`, the harness resets it |
| `src/docs/plan.ts:26–32` | `DatabricksConnectionMeta` is a Databricks-shaped durable field; `DatasetMeta.source` is `"file" \| "databricks"` |
| `src/tools/databricks-tools.ts:82` vs `src/tools/analyst-tools.ts:143` | two markdown row renderers; only one escapes `\|` and newlines |
| `src/tools/databricks-tools.ts:94` vs `src/tools/analyst-tools.ts:88` | two profile renderers; the local one has no median column |
| `src/plugins/transports.ts:1–204` | MCP over stdio and script only; `McpSqlClient` is a separate streamable-HTTP client |

Reads of the adapter global: 8 call sites. `DataAdapter` has two real implementations (SQLite,
Databricks), so the seam is real; what is missing is a module at it.

## Direction

One **data source session** module owns the live source for a conversation: connect, status,
discover, profile, query, metric, close. It is the only writer of the plan's source record. Databricks
becomes the first **provider**; Snowflake and BigQuery are the next ones; local CSV/JSON is a provider
whose extra capability is `intake`.

### Interface (callers)

- `status()` — never throws. The console, the prompt section and evals read this instead of three
  globals. States: `idle` (local scratch only), `connecting`, `live(record)`, `failed(error)`.
- `connect(intent)` — resolve credentials, open the transport, verify the manifest's tool names,
  prove read-only, then write `plan.dataSource`. A failed connect leaves the previous session live
  and the plan untouched.
- `discover(step, scope?)`, `describe` via `discover("columns")`, `profile`, `query`, `metric` — one
  method per model tool, structured returns, no rendered text.
- `close()` — aborts in-flight calls, closes the provider; idempotent.
- `intake?` — CSV/JSON load, present only when the provider declares it.

Abort is a per-call argument. No mutable signal field.

### Provider port (implementation)

A provider is resolved once per process from a manifest, plus a dialect. It guarantees:

- `probe()` — the declared tools exist, the read-only mode is available, and which native
  describe/profile tools exist.
- `execute(sql, { readOnly: true, maxRows, signal })`.
- optional native `datasets`, `columns`, `profile` when the MCP server already answers them.
- `close()`.

Conformance is a shared suite, written against an in-memory fake provider before the first real one.
Every provider — including a mock Snowflake and BigQuery — must pass it. That suite is the seam's
test surface.

### Dialect

`databricks`, `snowflake`, `bigquery`, `ansi`. Pure modules: quoting, qualification, list and
describe SQL, profile aggregate, percentile and correlation expressions, type classification,
read-only check. **This is the only place TypeScript is required**, and the cost is per dialect, not
per source: the four above are written once, and every later source speaking one of them is
manifest-only.

Dialect is code, not JSON templates. A template language would need to express `PERCENTILE_APPROX`
vs `PERCENTILE_CONT` vs `APPROX_QUANTILES`, case folding, and `INFORMATION_SCHEMA` shapes; getting
one wrong returns a plausible wrong number.

### Adding a source

`plugins/<name>/plugin.json` gains a `dataSource` block and an `mcp-http` transport:

```jsonc
{
  "name": "snowflake",
  "version": "1.0.0",
  "description": "Snowflake warehouse over MCP",
  "domain": "data",
  "capabilities": [],
  "transport": { "type": "mcp-http", "url": "${SNOWFLAKE_MCP_URL}" },
  "dataSource": {
    "dialect": "snowflake",
    "tools": { "query": "run_sql", "describe": "describe_table", "inventory": "list_objects" },
    "readOnly": { "mode": "tool", "tool": "run_sql", "argument": "read_only", "value": true },
    "auth": [
      { "kind": "env", "vars": ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_TOKEN"] },
      { "kind": "cli-profile", "default": "prod" }
    ]
  }
}
```

Read-only modes: `tool` (the named tool or argument is read-only), `role` (server-enforced, declared
for the record), `checked` (dialect parse). A manifest declaring none is refused at connect — fail
closed, not advisory.

If the server publishes no `describe` or `profile`, the session uses the dialect and marks the
result `derivation: "dialect:<name>"`; a native tool marks it `derivation: "native"`. Every profile
and metric carries that field, the same honesty rule the plugin system applies to `method` and
`warnings`.

Adding a source therefore costs: one manifest, credentials, and — only for a genuinely new SQL
dialect — one dialect module. No change to the session, the tools, the plan, the console or the tests.

### Tool surface (constant)

| Tool | Replaces |
| --- | --- |
| `list_data_sources` | — (new; reads installed providers) |
| `connect_data_source` | `connect_databricks` |
| `discover_data` | `list_databricks_assets` |
| `profile_table` | `profile_databricks_table` |
| `query_data` | `query_databricks` and `run_analytical_query` |
| `calculate_metric` | `calculate_statistical_metric` |
| `load_dataset` | `profile_dataset` (local provider only) |

Seven tools, the same count the model sees today, with no per-source variant ever added. No aliases:
`query_databricks` disappears.

### Plan record and migration

`AnalystPlanDoc` version 2, with `migrate(1 → 2)`:

```
plan.databricks  →  plan.dataSource: {
  provider, dialect, endpoint?, namespace?, dataset?, authRef: { kind, profile? }, connectedAt
}
```

Names and kinds only, never a token. The session is its only writer. `DatasetMeta.source` becomes
`{ provider, dataset }`; `"file"` is the local provider. The existing `migrate` support in
`defineDoc` (`src/docs/agents.ts:143`) is the pattern.

### Transport

Add `"mcp-http"` (streamable HTTP plus a token factory) to `plugins/transports.ts`, generalising
`McpSqlClient`, including its Databricks result decoding. Databricks becomes the first manifest that
uses it; the bespoke client moves behind the transport port rather than staying beside it.

### Staging

1. Session module, generic tools, Databricks provider, plan migration, fake-provider conformance
   suite. No new source, no behaviour change.
2. `mcp-http` transport, `dataSource` manifest block, dialect registry with `snowflake` and
   `bigquery`, exercised by fake MCP servers in tests.
3. Console: `/api/datasources` and a provider-driven status card. The Databricks auth panel stays as
   provider #1's panel; other providers connect from chat or CLI until their panel earns its keep.

## Wins

- Locality: one writer of the source record, one renderer, one read-only rule, one abort path.
- Leverage: six reads collapse onto one interface; seven tools serve every provider.
- Adding Snowflake is a manifest, not a code path.
- The abort race and the `connectedAt` divergence disappear with the duplicate writers.
- The conformance suite makes "this provider works" verifiable instead of asserted.
- Evals and the console stop sharing a process-wide adapter slot.

## Decisions (accepted 2026-10-21)

1. **Tool names are source-neutral, with no aliases.** `list_data_sources`, `connect_data_source`,
   `discover_data`, `profile_table`, `query_data`, `calculate_metric`, `load_dataset`.
   `connect_databricks`, `query_databricks`, `list_databricks_assets`, `profile_databricks_table`,
   `run_analytical_query` and `profile_dataset` are deleted, not aliased.
2. **Dialect is code**, from the fixed set `databricks | snowflake | bigquery | ansi`, named by the
   manifest. No JSON SQL templates: the failure mode is a plausible wrong number, not an error.
3. **The meta-agent may install a `dataSource` manifest** through `features_create_plugin`, like any
   other plugin. It cannot supply credentials, so connect stays a user act (chat, CLI, or console).
4. **One live source per conversation.** A join across two sources is refused, and the refusal names
   the two sources instead of emulating the join.
5. **Local files are a provider with `intake`.** Remote providers never implement `loadCsv`.
6. **Tools are built per harness by a factory** that closes over the session registry. `defineTool`
   at module scope plus a module-level registry would recreate the global this spec removes.

Residual, non-blocking: a per-provider console panel is deferred to stage 3. Until then only
Databricks has a panel; other providers connect from chat or CLI.

## Open questions

1. ~~Tool names.~~ Decided: source-neutral, no aliases.
2. ~~Dialect as code.~~ Decided: code, named by the manifest.
3. ~~Agent-installed sources.~~ Decided: allowed, credentials remain a user act.
4. ~~Cross-source work.~~ Decided: one live source, cross-source joins refused.

## Acceptance

- Two concurrent tool calls keep their own abort signals.
- A plan record written from the console, from the connect tool and from a restart produces the same
  fields; a version-1 document with `databricks` migrates and still reconnects.
- A local query whose cell contains `|` renders an intact markdown table.
- **A test fixture manifest for a fake `snowflake` provider opens a session, queries, profiles and
  passes the conformance suite with zero changes under `src/datasource/`.** This is the test that
  proves the extensibility claim.
- A provider whose manifest names a missing tool fails at connect, naming the server's real tool
  list; it never binds to a similarly named tool.
- A provider declaring no read-only mode is refused at connect.
- `createAnalystHarness({ databricks: false })` plus an eval run do not observe the console's session.

## Out of scope

OAuth flows, profile discovery and token refresh in `src/mcp/` (they stay, behind the credential
port); cross-source joins; a provider marketplace. The console's Databricks panel is unchanged in
stage 1.
