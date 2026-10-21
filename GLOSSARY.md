# Glossary

Domain nouns this project uses in code, docs and specs. Keep this file current: when a module is
named after a concept, the concept belongs here.

## Data

**Data source** — somewhere queries run. Either a local dataset loaded into SQLite, or a remote
warehouse reached over MCP (Databricks, Snowflake, BigQuery). One data source is live per
conversation.

**Provider** — the thing that knows how to reach one kind of data source: its transport, auth,
dialect, and which of the MCP server's tools mean query, describe, inventory and profile. Declared
by a manifest (`dataSource` block in `plugins/<name>/plugin.json`), backed by code only for a new
SQL dialect.

**Session** — the one live provider connection belonging to a conversation. Owns connect, status,
discover, profile, query, metric, and close, and is the only writer of the plan's source record.

**Dialect** — the SQL rules a provider owns: identifier quoting and qualification, catalog/schema/
table listing, describe, profile aggregates, percentile and correlation functions, type
classification, and the read-only check. Code, not configuration.

**Dataset** — the table currently in focus, named in the source's own convention
(`catalog.schema.table`, `project.dataset.table`, or a local table name).

## Agent

**Specialist** — a durable roster agent with its own conversation, profile, capabilities and compute
home. The coordinator is the specialist that manages the roster.

**Capability** — a name a specialist is configured with (`analyst`, `databricks`, `coding`,
`plugins`, `roster`, `features`, `all`, `plugin:<name>`, or an explicit tool name), resolved against
the live registry each turn. Distinct from a plugin's *capability id* (`stats.compare_eval_runs@1`),
which is a versioned operation a plugin implements.

**Compute** — where a specialist's files and shell live: `shared`, `local` (a private home), or
`docker` (private home plus an isolated container).

## Work

**Finding** — an observation recorded in `FindingsDoc`, with the query or metric that supports it,
an impact and a confidence. It is audited only after the auditor returns a verdict.

**Audit verdict** — `confirmed`, `caution` or `rejected`, written only by the auditor path. A
finding that was never audited is not confirmed.

**Playbook** — `PlaybookDoc`: learned heuristics, anti-patterns and query templates, versioned as it
is improved from telemetry.

**Plan** — `AnalystPlanDoc`: the goal, milestone, hypotheses, the active dataset, and the live data
source record.
