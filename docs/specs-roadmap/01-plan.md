# 01 · Implementation plan

Ordered steps for [01-data-source-session.md](01-data-source-session.md). Each step ends with a gate:
`bun test` green, and after stage 1 also `bun run evals` deterministic. Steps are sized so a step can
be reviewed alone.

Two constraints shape the order:

- **The conformance suite comes before the first real provider.** The fake fixes the error taxonomy
  and the field names; the real provider is written to pass it, not the other way round.
- **Tools are factory-built per harness.** `ToolExecutionApi` exposes `conversationId`, `registry`,
  `env` and `commit` but no dependency bag, so a statically defined tool can only reach a session
  through module state. `createAnalystTools({ sessions })` installed by `createAnalystHarness` keeps
  the registry per harness and keeps multi-harness tests honest.

## Progress

- [x] **1. `mcp-http` transport** — `src/mcp/http-mcp-client.ts` (connect, list, call, one auth
  re-mint, per-call abort), `mcp-http` manifest validation with `${ENV_VAR}` expansion, wiring in
  `agent-tools`, `plugins:list --check` and the console check. 13 tests in
  `tests/mcp-http-transport.test.ts`; `bun test` 120 pass. Deviation from the step as written:
  Databricks result decoding stays in `normalizeStatementResult` (a pure export of
  `mcp-sql-client.ts`) rather than moving into the transport, because it decodes SQL payloads, not
  the wire. The Databricks provider in step 7 will import it.
- [x] **2. `dataSource` manifest block** — `DataSourceManifest` in `plugins/types.ts`, validation
  in `manifest.ts` (dialect set, tool roles, read-only modes, auth kinds, argument mapping), and the
  tool bridge now skips a data source so no warehouse is contacted at harness open. 14 tests in
  `tests/data-source-manifest.test.ts`; documented in `docs/plugins.md`.
- [x] **3. Types: records, errors, ports** — `src/datasource/types.ts`: `SourceRecord` / `ConnectIntent` /
  `SourceStatus`, discovery, `ProfileResult` and `MetricResult` (each carrying `derivation`),
  `DataSourceSession`, and the `DataProvider` / `Dialect` / `DatasetIntake` ports. `SourceError` is
  a class over a closed code set with a retryable subset, rather than a bare union: it has to be
  throwable and keep its stack. `DescribedColumn` / `ColumnKind` moved here, and the Databricks
  adapter imports them instead of declaring a second shape. 4 tests in
  `tests/datasource-types.test.ts`.
- [x] **4. Dialects: `ansi` and `databricks`** — `src/datasource/dialects/` (a shared profile builder,
  Databricks with `SHOW`/`DESCRIBE`/`PERCENTILE_APPROX`/`CORR`, ANSI with `INFORMATION_SCHEMA` and
  `PERCENTILE_CONT`), identifier quoting moved to `src/datasource/identifiers.ts` and re-used by
  `mcp-sql-client`. The Databricks adapter no longer builds SQL by hand (−77 lines). 16 golden tests
  in `tests/dialects.test.ts`; the profile aggregate is asserted string-for-string against what the
  adapter emitted before. `dialectFor()` fails closed with `dialect-missing` for a dialect with no
  module yet.
- [x] **5. The fake provider and the conformance suite** — `tests/fixtures/providers/fake.ts` is an
  in-memory warehouse (describe, inventory, and the profile aggregate the dialect generates) with
  scripted scenario faults; `conformance.ts` holds the reusable suite. 15 tests, all through the
  port. `read-only-violation` joined the error codes so a refused mutation is distinct from a query
  error.
- [x] **6. The session** — `src/datasource/session.ts`: `DataSourceRegistry` (one session per
  conversation) over two ports, `ProviderCatalog` and `SourceRecordStore`. Connect opens → probes →
  `SELECT 1` → writes the record last; a failed connect closes the new provider and leaves the
  previous source live. `status()` never throws; `close()` aborts in-flight calls; profile composes
  from describe + the dialect's aggregate (or a native one) and carries `derivation`; reconnect from
  the record has a cooldown. 23 tests in `tests/datasource-session.test.ts`, including every
  provider failure arriving through the session unchanged.
- [x] **7. The Databricks provider** — `src/datasource/providers/databricks.ts` behind the provider
  port (lazy connect, `probe()` proves a read-only tool, errors translated to the closed taxonomy),
  and `src/datasource/catalog.ts` resolving Databricks plus every manifest with a `dataSource` block.
  `providers/manifest.ts` is the manifest provider: declared tools verified against `listTools()` at
  connect, argument names from `dataSource.arguments` with defaults, results decoded fail-closed,
  native describe/inventory/profile used when published. Deviation: Databricks stays built in rather
  than becoming a manifest, because OAuth refresh and host-derived endpoints are not expressible
  there yet. `McpToolClient.callTool` gained a `signal`. 35 tests across the two provider files; the
  Databricks provider passes the same conformance suite over a local MCP server, and
  `bun run demo:databricks samples.nyctaxi.trips` still profiles and queries a real workspace.
- [x] **8. Plan record v2** — `AnalystPlanDoc` is version 2: `dataSource?: SourceRecord` replaces
  `databricks`, and `DatasetMeta.provider` replaces the `source` discriminator. `migratePlanDocument`
  is a pure exported function (7 tests in `tests/plan-migration.test.ts`). `databricksRecord()` is now
  the one shape the console, the connect tool and the harness write, so a migrated record and a fresh
  one are equal. `bun run cli plan` on a copy of the repo's SQLite prints the migrated source.
  The document types became type aliases so they satisfy `JsonObject`; that removed the last
  `defineDoc` type error for the plan.
- [x] **9. Tools: the factory and the seven** — `createDataSourceTools({ sessions })` in
  `src/tools/datasource-tools.ts`: `list_data_sources`, `connect_data_source`, `discover_data`,
  `profile_table`, `query_data`, `calculate_metric`, `load_dataset`. One row and one profile
  renderer. `createAnalystTools()` builds the extension per harness with a late-bound registry, and
  the auditor subagent receives its data tools from the same factory.

## Stage 0 · Groundwork (no behaviour change)

**1. `mcp-http` transport.**
Add `transport.type: "mcp-http"` to `src/plugins/transports.ts` (streamable HTTP, token factory,
`listTools`/`callTool`/`close`), generalising `src/mcp/mcp-sql-client.ts`, including its Databricks
result decoding and statement polling.
*Files:* `src/plugins/transports.ts`, `src/plugins/types.ts`, `src/mcp/mcp-sql-client.ts`.
*Tests:* reuse the local fake MCP HTTP server in `tests/databricks-mcp.test.ts`; the existing
Databricks decode tests move to the transport and stay green.
*Gate:* the transport parses a real-shaped Databricks response and a plain `{columns, rows}` response.

**2. `dataSource` manifest block.**
Extend `PluginManifest` with an optional `dataSource: { dialect, tools, readOnly, auth, arguments? }`
and validate it in `manifest.ts`: dialect is one of the four names, every mapped tool name is a
non-empty string, `readOnly.mode` is `tool | role | checked` and `tool` mode names its tool.
*Files:* `src/plugins/types.ts`, `src/plugins/manifest.ts`, `docs/plugins.md`.
*Tests:* each validation error names the source file and the first problem; a manifest without the
block validates exactly as today.
*Gate:* `bun run plugins:list --check` unaffected for existing manifests.

## Stage 1 · The session, Databricks only

**3. Types: records, errors, ports.**
`src/datasource/types.ts`: `SourceRecord`, `SourceStatus`, `ConnectIntent`, `Discovery`,
`MetricSpec`, the closed `SourceError` union (`not-configured`, `auth-expired`, `auth-denied`,
`read-only-unavailable`, `unsupported-capability`, `dialect-missing`, `query-error`, `transport`,
`aborted`, `no-session`), the `DataProvider` port, `DatasetIntake`, and `Dialect`.
*Gate:* typecheck only; no runtime.

**4. Dialects: `ansi` and `databricks`.**
Move the SQL out of `src/adapters/databricks-adapter.ts` into pure modules: quoting and
qualification, `SHOW CATALOGS` / `SHOW SCHEMAS` / `SHOW TABLES`, `DESCRIBE TABLE`, the profile
aggregate, `PERCENTILE_APPROX`, `CORR`, type classification, read-only check. `ansi` is the fallback
(no discovery; describe via `INFORMATION_SCHEMA`).
*Files:* `src/datasource/dialects/{ansi,databricks}.ts`.
*Tests:* golden strings for a two-column table, an identifier needing escaping, and a temporal column.
*Gate:* generated SQL for the Databricks fixture matches what the adapter emits today.

**5. The fake provider and the conformance suite.**
`tests/fixtures/providers/fake.ts`: in-memory datasets, scripted faults (`auth-expired` once,
missing describe, missing profile, read-only violation, abort, unreachable), a `recordingDialect`.
`tests/datasource-conformance.test.ts` runs the same suite against any provider.
*Gate:* the suite has at least twelve cases and the fake passes all of them.

**6. The session.**
`src/datasource/session.ts`: per-conversation registry; `connect` ordering (resolve credentials →
open transport → verify declared tools against `listTools()` → read-only proof → first probe → write
`plan.dataSource` last); `status()` never throws; `discover` / `profile` / `query` / `metric` with
per-call `signal`; `close()` aborts in flight then closes; reconnect from the plan with a cooldown.
*Tests:* two conversations, two sessions, nothing shared; a failed connect leaves the previous
session live and the plan untouched; a missing declared tool fails with the server's real tool list;
two concurrent queries keep their own signals; close during a query ends it.
*Gate:* the fake provider passes the conformance suite through the session.

**7. The Databricks provider.**
`src/datasource/providers/databricks.ts`: wrap the `mcp-http` transport and the `databricks` dialect;
`native` is empty (its MCP publishes `execute_sql_read_only` only), so describe and profile come from
the dialect and are marked `derivation: "dialect:databricks"`. Credentials come from
`resolveDatabricksConfig` behind the credential port.
*Gate:* `bun run demo:databricks samples.nyctaxi.trips` still profiles and queries.

**8. Plan record v2.**
Bump `AnalystPlanDoc` to version 2 with `migrate(1 → 2)`: `databricks` → `dataSource`, preserving
`connectedAt`; `DatasetMeta.source` becomes `{ provider, dataset }`. The session is the only writer.
*Files:* `src/docs/plan.ts`, `src/console/api/workspace.ts`, `src/tools/databricks-tools.ts` (delete its
plan writes).
*Tests:* a version-1 document with `databricks` migrates and reconnects; a version-2 write from the
console and from the connect tool produce identical fields.
*Gate:* `bun run cli plan` on a copy of the repo's `agent_analyst.sqlite` shows the migrated record.

**9. Tools: the factory and the seven.**
Split `AnalystExtension` into a static part (sections, tasks, hooks) and `createAnalystTools({ sessions })`.
Add `list_data_sources`, `connect_data_source`, `discover_data`, `profile_table`, `query_data`,
`calculate_metric`, `load_dataset`; delete the Databricks quartet, `run_analytical_query` and
`profile_dataset`. One row renderer and one profile renderer, escaping `|` and newlines.
*Files:* `src/tools/datasource-tools.ts` (new), `src/extensions/analyst-extension.ts`, `src/harness.ts`.
*Tests:* each tool with the fake provider; the local `load_dataset` path with `sample-data/customer_churn.csv`;
a cell containing `|` renders intact.
*Gate:* tool count for `durable-analyst` is unchanged except for the deleted Databricks pair, and the
read-only hook no longer keys on tool names.

**10. Rewire the callers; delete the globals.**
`harness.ts`, `console/api/workspace.ts`, `console/api/databricks-api.ts`, `tasks/analysis-workflow.ts`,
`evals/run.ts`, `cli.ts`, `src/index.ts`: everything asks the session. Delete `sharedAdapter`,
`getOrCreateAdapter`, `setSharedAdapter`, `releaseSharedAdapter`, `getSharedAdapter`, `bindAbort`,
`activeDatabricks`, `noteDatabricksAdapter`, `bindSignal`, and the plan-writing blocks. Reduce
`src/adapters/databricks-adapter.ts` to the transport decoder (or delete it once the transport owns
that).
*Gate:* `rg "sharedAdapter|activeDatabricks|bindAbort|plan\.databricks"` returns nothing. `bun test`
green, `bun run evals` deterministic, `bun run demo` and `bun run demo:resilience` still work.

## Stage 2 · Prove the extensibility claim

**11. `snowflake` and `bigquery` dialects.**
Pure modules with the same surface and golden-SQL tests: quoting and case folding, discovery,
describe, profile aggregate, `PERCENTILE_CONT` / `APPROX_QUANTILES`, `CORR`, read-only check.
*Gate:* no provider code imports either; they are reached only through a manifest's dialect name.
*Done:* `snowflake.ts` (SHOW, `DESCRIBE TABLE`, `PERCENTILE_CONT`, `NUMBER` scale classification) and
`bigquery.ts` (`INFORMATION_SCHEMA`, `APPROX_QUANTILES`, `FLOAT64`). `providers/local.ts` landed with
them: CSV/JSON as a provider with `intake`, native discovery and profile, listed by the catalog next
to Databricks.

**12. The fixture that proves the claim.**
`tests/fixtures/plugins/fake-snowflake-mcp/` (an MCP server over stdio, modelled on
`fake-stats-mcp`) plus `plugin.json` with the `dataSource` block. A test opens a session from that
manifest, profiles a table, runs a query and passes the conformance suite.
*Gate:* **zero changes under `src/datasource/`** accompany this step. If a change is needed, the
provider seam is wrong and stage 1 is not done.
*Done:* `tests/fixtures/plugins/fake-snowflake-mcp/` (manifest + stdio server) and
`tests/datasource-snowflake-fixture.test.ts`: connect, discover, describe, profile with
`derivation: "dialect:snowflake"`, query, and a refused mutation. No file under `src/datasource/`
was touched for it.

**13. Console.** — *done*: `GET /api/datasources` (providers + live status for the active agent) and a `DataSourcesCard` on the Settings page. The Databricks auth panel stays as provider #1's panel.
`GET /api/datasources` (status for the active conversation plus installed providers), and a status
card driven by `status()`. The Databricks auth panel stays as provider #1's panel.
*Gate:* with no source connected the page renders `idle`; with Databricks live it renders the record.

## Stage 3 · Cleanup, docs, deletion

**14. Remove the leftovers.** — *done*: the adapter's mutable `bindSignal` (no callers left), the old tool modules, `getSharedAdapter`, `describeActiveDatabricks`, and the duplicate row/profile renderers are gone; the SQL guard reads `call.arguments` and delegates to `isReadOnlySql`. `getSharedAdapter` (unused), the duplicate row/profile renderers, the
`beforeTool` SQL regex (the provider's read-only mode replaces it), and the dead `logger`-style
helpers left in the old adapter.

**15. Documentation.** — *done for the parts this change owns*: README's data-source section and tool names, `CLAUDE.md`'s data-source bullets, `docs/plugins.md`, the AGENTS.md template and the data-exploration skill. The workspace's own AGENTS.md is runtime data and was not rewritten. `README.md` data-source section, `docs/plugins.md` `dataSource` block,
`CLAUDE.md` data-sources bullet, `AGENTS.md` template and `MAIN_AGENT_INSTRUCTIONS` with the new tool
names, `ChatComponents` labels, `evals/scripted-agent.ts` steps. This step is last because it is the
only one that is tedious in proportion to the rename, and candidate 03 makes most of it mechanical.

## Risks

| Risk | Where it bites | Mitigation |
| --- | --- | --- |
| `ToolExecutionApi` has no dependency bag | step 9 | factory-built tools per harness; fail the builder loudly if a session is missing |
| Doc migration runs against a live SQLite | step 8 | never delete `databricks` in the same commit; keep it readable for one version |
| Databricks result decoding is subtle | step 0 | move the existing tests with the code, do not rewrite them |
| A manifest names a tool the server renames | stage 2 | verify at connect, fail with the server's real tool list |
| Token expires mid-query | stage 1 | replay once through the token factory, then `auth-expired` |
| Dialect emits a wrong percentile | stage 1/2 | `derivation` on every profile and metric; golden-SQL tests |
| Provider tool names collide with agent tool names | step 2 | prefix or reject at validation; agent tools win, never silently |
| An `mcp-http` data source is contacted at harness open, because the plugin bridge lists its tools eagerly | step 2/7 | mark `dataSource` manifests so the tool bridge skips them and the session opens lazily |

## Not in this plan

Cross-source queries, a per-provider console panel, a provider marketplace, and the eval harness
reading a second source. Each has a home in the spec's out-of-scope section; none is needed to prove
the seam.
