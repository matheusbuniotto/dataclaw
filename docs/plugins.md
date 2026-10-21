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
| `transport.type` | yes | `mcp` or `script`. |
| `transport.command`, `args` | yes / no | Program to start. |
| `transport.env` | no | Extra environment variables (added to DataClaw's own). |
| `transport.cwd` | no | Working directory, relative to the manifest. Default: the manifest's directory. |
| `transport.tools` | no (mcp) | Capability id → MCP tool name. Default: the part between the first `.` and `@` (`stats.compare_eval_runs@1` → `compare_eval_runs`). |

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
built-in fallback, and eval shaping.

## Next step: plugin capabilities as agent tools

Today plugins serve the eval pipeline (`evals:compare`, `evals:calibrate`). Exposing
capabilities to the analyst agent itself would mean registering one tool per installed
capability with the harness (`src/harness.ts`, `src/tools/*`), with a JSON schema taken from
the capability contract. It would also need durable replay of plugin calls so a resumed
session sees the same results. That is a separate change.
