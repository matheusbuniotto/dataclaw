# Data plugins

DataClaw can hand specialised data work to external programs called **plugins**. A plugin
declares named, versioned **capabilities**, and DataClaw calls whichever installed plugin
provides the one it needs. Stats is the first domain (`docs/capabilities/stats.md`). The same
mechanism suits machine learning (train, score, explain), forecasting, FP&A (budget vs actual,
driver models), data quality checks, or anything else that takes data in and returns
structured results.

DataClaw never needs to know what a plugin is written in or which library it wraps. A
Python service on SciPy or statsmodels, an R script, a Rust binary and a hosted model all
look the same from the inside.

## How it fits together

```
agent ──► teatools__analyze        (one harness tool per MCP tool, docs below)
         │
         └─► PluginClient.callTool("analyze", input)

evals:compare ──► resolveCapability("stats.compare_eval_runs@1")
                        │  picks the best installed provider
                        ▼
                  PluginClient.invoke(capability, input)   ◄── one interface
                   ├─ mcp:    MCP over stdio (official TypeScript SDK client)
                   └─ script: run a command, JSON on stdin, JSON on stdout
```

Code: `src/plugins/` (manifest loading, the two transports, capability resolution) and
`src/plugins/capabilities/*.ts` (typed contracts with output validation).

When no plugin provides a capability, callers fall back to their built-in TypeScript
implementation and say so. `evals:compare` prints the built-in report;
`evals:calibrate score` shows only the built-in numbers.

## Installing a plugin

DataClaw looks for manifests in this order:

1. `plugins/<name>/plugin.json` under the project root.
2. `dataclaw.plugins.json` in the project root: `{ "plugins": [ <manifest>, ... ] }`.
3. Each entry of `DATACLAW_PLUGIN_PATH` (`:`-separated): a manifest file, a plugin directory,
   or a directory of plugin directories.

Two plugins with the same name are an error. Check what is installed (and, with `--check`,
start every MCP plugin and list its tools):

```bash
bun run plugins:list --check
```

When several plugins provide one capability, the one with the highest `priority` wins (then
by name). `DATACLAW_PLUGIN=<name>` prefers a plugin wherever it applies, and commands that
take `--plugin <name>` require that plugin. `--builtin` skips plugins.

## Manifest

```json
{
    "name": "my-stats",
    "version": "0.1.0",
    "description": "Eval comparisons and rater agreement",
    "domain": "stats",
    "capabilities": ["stats.compare_eval_runs@1", "stats.agreement_kappa@1"],
    "priority": 0,
    "transport": {
        "type": "mcp",
        "command": "uv",
        "args": ["run", "--directory", "/path/to/my-stats", "my-stats-mcp"],
        "env": { "LOG_LEVEL": "warning" },
        "cwd": ".",
        "tools": { "stats.compare_eval_runs@1": "compare_eval_runs" }
    }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Lowercase id (`[a-z0-9][a-z0-9_.-]*`), unique among installed plugins. |
| `version` | yes | The plugin's own version, shown in output next to every number it produced. |
| `description` | yes | One line for `plugins:list`. |
| `domain` | yes | Free-form area: `stats`, `ml`, `forecasting`, `fpa`, ... |
| `capabilities` | yes | Capability ids it implements, `domain.name@major`. |
| `priority` | no | Higher wins when plugins overlap. Default 0. |
| `transport.type` | yes | `mcp` (stdio), `mcp-http` (streamable HTTP), or `script`. |
| `transport.command`, `args` | yes / no (`mcp`, `script`) | Program to start. Rejected for `mcp-http`. |
| `transport.env` | no (`mcp`, `script`) | Extra environment variables (added to DataClaw's own). |
| `transport.cwd` | no (`mcp`, `script`) | Working directory, relative to the manifest. Default: the manifest's directory. |
| `transport.url` | yes (`mcp-http`) | Endpoint. `${ENV_VAR}` is expanded when the client opens; a missing variable is an error, not an empty string. |
| `transport.headers` | no (`mcp-http`) | Headers sent with every request; values may reference `${ENV_VAR}`. |
| `transport.bearerEnv` | no (`mcp-http`) | Environment variable holding a bearer token. Re-read once after an auth failure. |
| `transport.tools` | no (`mcp`, `mcp-http`) | Capability id → MCP tool name. Default: the part between the first `.` and `@` (`stats.compare_eval_runs@1` → `compare_eval_runs`). |

### HTTP MCP servers

A remote MCP server needs no local process:

```json
{
    "name": "snowflake",
    "version": "1.0.0",
    "description": "Snowflake warehouse over MCP",
    "domain": "data",
    "capabilities": [],
    "transport": {
        "type": "mcp-http",
        "url": "${SNOWFLAKE_MCP_URL}",
        "bearerEnv": "SNOWFLAKE_TOKEN"
    }
}
```

`mcp-http` accepts an empty `capabilities` because its tools go to the agent, like an stdio MCP
plugin. Endpoints and credentials come from the environment: the manifest names them, it does not
contain them. A 401 or 403 triggers one re-read of `bearerEnv` (or one `tokenProvider(force)` call
for code-built clients) before the call fails.

### Data sources

A plugin that is a **data source** — a warehouse you connect to and query, rather than a list of
capabilities — adds a `dataSource` block. The session that reads it is described in
[specs-roadmap/01-data-source-session.md](specs-roadmap/01-data-source-session.md); until that lands,
the block is validated and the plugin is left unopened.

```json
{
    "name": "snowflake",
    "version": "1.0.0",
    "description": "Snowflake warehouse over MCP",
    "domain": "data",
    "capabilities": [],
    "transport": { "type": "mcp-http", "url": "${SNOWFLAKE_MCP_URL}", "bearerEnv": "SNOWFLAKE_TOKEN" },
    "dataSource": {
        "dialect": "snowflake",
        "tools": { "query": "run_sql", "describe": "describe_table", "inventory": "list_objects" },
        "readOnly": { "mode": "tool", "tool": "run_sql", "argument": "read_only", "value": true },
        "auth": [
            { "kind": "env", "vars": ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_TOKEN"] },
            { "kind": "cli-profile", "default": "prod" }
        ],
        "arguments": { "query": "sql" }
    }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `dataSource.dialect` | yes | `databricks`, `snowflake`, `bigquery` or `ansi`. The dialect supplies SQL when the server publishes no `describe`/`profile` tool. |
| `dataSource.tools.query` | yes | The server tool that runs a statement. |
| `dataSource.tools.describe` | no | The server tool that describes a table. Absent: the dialect generates it. |
| `dataSource.tools.profile` | no | The server tool that profiles a table. Absent: the dialect generates it. |
| `dataSource.tools.inventory` | no | The server tool that lists catalogs, schemas or tables. |
| `dataSource.readOnly` | yes | `{ mode: "tool", tool?, argument?, value? }`, `{ mode: "role", note? }` or `{ mode: "checked" }`. A source declaring none is refused at connect. |
| `dataSource.auth` | no | Credential sources in order: `env` (with `vars`), `cli-profile` (with optional `default`), `oauth`, `service-principal`. Names only. |
| `dataSource.arguments` | no | Argument name each tool expects. Defaults: `query` → `sql`, `describe` → `table`, `inventory` → `namespace`, `profile` → `table`. |

A `dataSource` requires an MCP transport (`mcp` or `mcp-http`), never a script. The tool bridge does
not open it: listing its tools at harness open would reach the warehouse before a conversation
connects.

Every declared tool is checked against what the server actually lists when a conversation connects.
A name the server does not publish fails with the real list, so a typo cannot bind to the wrong tool:

```
the snowfake server does not publish describe tool "describe_table".
Available tools: run_sql, list_objects
```

Discovery and profiling fall back to the dialect when a tool is absent: omit `tools.describe`,
`tools.inventory` or `tools.profile` and the session runs `dataSource.dialect`'s SQL instead. A
declared `tools.profile` must return `{ rowCount, columns: [{ name, type, nullCount, nullPct,
distinctCount, sampleValues }] }`; anything else is refused, and the message says to drop the entry
and let the dialect profile the table.

The read-only mode decides how mutations are blocked. `{ "mode": "tool", "tool": "run_sql_read_only" }`
calls that tool instead of `tools.query`; `{ "mode": "tool", "argument": "read_only", "value": true }`
sets the flag on every call; `{ "mode": "role", "note": "..." }` records a server-enforced role; and
`{ "mode": "checked" }` relies on the dialect's statement check. Every query is also checked
client-side; a mutating statement is refused before the transport.

## Capabilities and versions

A capability id is `domain.name@major`, e.g. `stats.agreement_kappa@1`. The major version
names one input/output contract. Adding optional output fields does not change it. Removing
or renaming a field, or changing its meaning, needs a new major (`@2`), and a plugin may
provide both. DataClaw checks every result against the contract and rejects one that does not
match, naming the plugin.

Contracts take plain JSON (numbers, strings, arrays). DataClaw shapes its own records first,
so a plugin never has to understand DataClaw's file formats.

## Transport: `mcp`

A [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. DataClaw
starts it once per command, lists its tools, and fails early if a declared capability has no
matching tool. Each call passes the capability input as the tool's arguments. The result is
read from `structuredContent` (a lone `{"result": ...}` wrapper is unwrapped) or from JSON
text content. An `isError` result becomes an error carrying its text. Server stderr is kept
and shown if startup fails.

Use this when you already have an MCP server, or want one process to serve many calls.

## Transport: `script`

The simplest possible plugin. DataClaw runs `command args...` once per call, writes one JSON
object to stdin, and reads one JSON object from stdout:

```json
{"capability": "stats.agreement_kappa@1", "input": {"rater_a": ["yes", "no"], "rater_b": ["yes", "yes"], "alpha": 0.05}}
```

Reply with `{"output": {...}}` or `{"error": "message"}`. A non-zero exit is an error too,
and stderr is shown. Log to stderr, never stdout.

`examples/plugins/kappa-script/` is a complete one: a manifest plus a 60-line Bun script
that answers `stats.agreement_kappa@1`. Try it with:

```bash
DATACLAW_PLUGIN_PATH=examples/plugins/kappa-script bun run plugins:list
DATACLAW_PLUGIN_PATH=examples/plugins/kappa-script bun run evals:calibrate score labels.csv results.jsonl
```

## Writing your own

1. Pick or define the capability. For a new domain, write its contract down first: a
   `docs/capabilities/<domain>.md` page and a `src/plugins/capabilities/<domain>.ts` with
   input/output types and an output check (copy `stats.ts`). For example,
   `ml.train_classifier@1` (features matrix, labels, returns metrics and a model reference) or
   `forecasting.forecast_series@1` (timestamps, values, horizon, returns point forecasts and
   intervals).
2. Implement it in any language, behind MCP or a script.
3. Report your method and assumptions in the output (`method`, `warnings`). DataClaw shows
   them verbatim next to the numbers, together with the plugin name and version.
4. Never invent numbers. If an input is degenerate (one class, zero variance, too few
   cases), return what is defined and explain the rest in `warnings`.
5. Drop a manifest in `plugins/<name>/plugin.json` (or point `DATACLAW_PLUGIN_PATH` at it)
   and run `bun run plugins:list --check`.
6. Call it from code:

```ts
import { resolveCapability } from "./src/plugins";
import { compareEvalRuns } from "./src/plugins/capabilities/stats";

const cap = resolveCapability(compareEvalRuns);      // undefined when none is installed
if (cap) {
    try {
        const out = await cap.call({ scores_a, scores_b, paired: true, alpha: 0.05, ci_method: "analytic" });
    } finally {
        await cap.close();
    }
}
```

## Tests

`tests/plugins.test.ts` covers discovery, validation and resolution. It also runs a real MCP
handshake against a test-only server (`tests/fixtures/plugins/fake-stats-mcp/`, official SDK,
plain arithmetic, no inference), the example script plugin, contract rejection, the
built-in fallback, and eval shaping. `tests/plugin-agent-tools.test.ts` covers the agent
bridge: namespaced tool names, the published schema, calls and errors, a plugin that cannot
start, and the harness installing `data-plugins` plus `tool_search`.

## Agent tools

An installed plugin's tools are also available to the analyst agent itself: one harness tool per
MCP tool, named `<plugin>__<tool>` (`teatools__analyze`, `teatools__power`, …). When the harness
opens, DataClaw connects to each MCP plugin once, reads the tool list and the JSON Schema each
tool publishes, and registers a durable tool per entry with that schema
(`src/plugins/agent-tools.ts`, `src/harness.ts`). Adding a tool to a plugin therefore needs no
DataClaw change: restart the process and the tool exists.

- **Deferred by default.** The tools are not in every request. A `data_plugins` prompt section
  lists the installed plugins and their tools, and `tool_search`
  (`@earendil-works/pi-durable/tool-search`) loads the ones the model picks; loaded tools stay
  offered for the rest of the conversation, including after a compaction. Pass
  `deferred: false` to offer them all up front.
- **`replay: "unsafe"`.** A plugin call is not a pure function of its arguments: `design` writes
  a pre-registration plan to disk, `report` reads one back. A call a crash interrupted is never
  rerun on recovery, so a resumed session cannot create the same plan twice.
- **Failures stay in the transcript.** A dead server, a timeout, or an `isError` result becomes an
  ordinary tool error naming the plugin; the model can retry or report it. A plugin that will not
  start at all is logged (`onError`) and skipped — the agent still opens.
- **One connection per plugin**, opened when the harness opens and closed with it. A Python
  server started through `uv run` costs a second or two there, not per call.
- **Script plugins contribute no agent tools**: a script answers one capability per invocation and
  publishes no tool inventory.
- Turn the whole thing off with `pluginTools: false` in `createAnalystHarness`; discovery is
  skipped and no plugin process starts.

### Self-authored plugins

DataClaw can write a plugin for itself from chat. `features_create_plugin` writes
`plugins/<name>/plugin.json` plus optional source files, and `features_apply` starts it, installs its
`<plugin>__<tool>` agent tools, and reconfigures roster agents against the new registry. This is the
same manifest and transport described above; nothing about the plugin contract changes. A plugin
that cannot start is reported by `features_apply`, never fatal (see `src/tools/feature-tools.ts`).

### In the console

**Capabilities** (`/console/capabilities`) is the management page: plugins, skills, built-in
tool groups and the Databricks MCP connection in one list, each with a switch. From there you
can also install a plugin (name, transport, command, args, env, capabilities — written to
`plugins/<name>/plugin.json`) and write a skill (`workspace/skills/<name>/SKILL.md`), or remove
one the page installed.

Switches are saved immediately in `dataclaw.capabilities.json` (gitignored):

```json
{ "disabled": ["plugin:teatools", "skill:data-exploration"] }
```

…and reach the agent on **Apply**, which closes the harness and opens it again, resuming the
same durable conversation from SQLite. A turn in flight blocks Apply (409), so nothing is lost.
A disabled plugin is skipped before its process starts; a disabled skill leaves the prompt but
stays on disk.

`src/capabilities/catalog.ts` builds the list (the harness reads the same file, so the page and
the running agent cannot disagree), and `src/console/api/capabilities-api.ts` adds the mutations:
`GET /api/capabilities`, `POST /api/capabilities/{toggle,apply,plugin,plugin/remove,skill,skill/remove}`.

Settings → **Data plugins** is the read-only view of the same manifests: version, domain,
transport, priority, the capabilities each plugin serves (struck through when another wins it
by `priority`), and the tools it contributed. **Check** runs the `plugins:list --check`
handshake, so it starts the servers, and only when the button is pressed. The workspace
snapshot (`GET /api/workspace` → `plugins`) carries it, built by `src/console/api/plugins-api.ts`.

Per-agent selection is the same mechanism one level up: a conversation stores which extensions
and tools it runs with, so a later change can switch a capability for one agent without
touching the workspace default.

```bash
# plugins/<name>/plugin.json (gitignored, so machine paths stay local) or DATACLAW_PLUGIN_PATH
bun run plugins:list --check     # confirms the server starts and lists its tools
```

A real one to point at: [`tea-tasting-tools`](https://github.com/matheusbuniotto/tea-tasting-tools)
(`teatools-mcp`, ten tools for experiment design, power, A/B analysis, SRM, pre-registration
reports and eval comparison), which also declares the two `stats.*` capabilities above.

## Next step: typed capability tools

Agent tools above use the plugin's own tool schemas, so their output is not checked. A domain
that earns it should graduate to a capability contract (`src/plugins/capabilities/<domain>.ts` +
`docs/capabilities/<domain>.md`) and a tool whose parameters come from that contract, so
`method` and `warnings` are validated and surfaced verbatim next to every number.
