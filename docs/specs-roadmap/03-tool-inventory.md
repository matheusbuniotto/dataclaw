# 03 · Derive the tool inventory

**Status:** `proposed` · **Strength:** Strong · **Seam:** in-process · **Size:** S

## Problem

The agent's tool inventory is written out six times across five modules. One of the copies has
already drifted from what is installed, and nothing asserts that any copy equals the registrations.

## Evidence

| Copy | Where | Contents |
| --- | --- | --- |
| Registrations | `src/extensions/analyst-extension.ts:186` | 28 tool objects |
| Capability groups | `src/docs/agent-capabilities.ts:11–55` | 5 string arrays: 11 analyst + 4 Databricks + 7 roster + 6 feature + 4 coding |
| Console catalog | `src/capabilities/catalog.ts:183–195` | 11 names in one `details.tools` array |
| Chat labels | `src/prototype/ChatComponents.tsx:640–693` | 21 display phrases, plus substring rules as a second classifier |
| Run summaries | `src/prototype/workspace.ts:827,868` | 14 tool names across `sourcesForTool` and `summarizeToolArgs` |
| Eval script + prompt | `evals/scripted-agent.ts:68–75`, `src/agent/instructions.ts:23–38` | 5 names; 20 in prose |

The drift, measured against the registrations:

- The console's analyst row lists 11 tools, **4 of which belong to the Databricks group**
  (`connect_databricks`, `query_databricks`, `list_databricks_assets`, `profile_databricks_table`).
- It **omits 17 installed tools**: the four auto-improvement tools, all seven roster tools, and all
  six self-extension tools.
- Turning off the Databricks group in the console therefore cannot be explained by the catalog: it
  reports those tools as part of the always-on analyst group.

`toolInventory()` (`src/tools/agent-tools.ts:401`) already builds the live name → extension map from
the registry snapshot. It has exactly one caller (`agentConfiguration`), so the bridge exists and is
simply not used by the other five readers.

## Proposed direction

Each tool declares itself once, together with the group it belongs to. The capability groups, the
console catalog, the features list, the chat labels, and the prompt's inventory are derived from
those declarations plus the live registry snapshot, so a plugin tool appears everywhere the moment
it is installed and a renamed tool cannot leave a stale string behind.

Display phrasing is optional metadata on the declaration. A tool without one gets the generic
phrase the chat already falls back to.

## What changes for callers

- `ANALYST_TOOLS`, `DATABRICKS_TOOLS`, `CODING_TOOLS`, `ROSTER_TOOLS`, `FEATURE_TOOLS` stop being
  hand-written arrays. `AGENT_CAPABILITY_GROUPS` keeps its descriptions and loses its literals.
- `capabilityCatalog()` reads the inventory instead of spelling out a row.
- `ChatComponents` looks up a phrase by name instead of maintaining a map and guessing by substring.
- `sourcesForTool` / `summarizeToolArgs` consult the declaration rather than a private list.

## Wins

- Six copies → one declaration per tool.
- The capabilities page cannot lie about what is installed or which group owns it.
- A new plugin tool shows up in the catalog, the features list, and the chat without an edit.
- Renaming a tool is one edit, and the type checker catches the call sites.
- Leverage: five readers, one declaration.

## Open questions

- Groups are currently a closed union (`AgentCapabilityGroup`). Keep it closed — plugins are
  addressed by `plugin:<name>`, not by a new group — and only the tool list becomes derived.
- `all` deliberately means "everything installed", including plugins. Keep it derived from the
  snapshot, not from the declaration list.
- The `beforeTool` SQL guard keys on tool names (`run_analytical_query`, `query_databricks`). Either
  give those tools a declaration flag ("runs SQL") and guard on that, or leave the guard alone and
  accept two places. Prefer the flag; it is the same knowledge.

## Acceptance

- One test asserts that the union of the capability groups equals the tools registered by
  `durable-analyst`, except the coding group, which is asserted against `CodingTools`.
- One test asserts that every capability entry's `details.tools` is a subset of the live inventory.
- One test asserts that every installed plugin tool appears in the catalog after `features_apply`.
- A deliberately disabled `tool:coding` removes exactly those four names from the derived lists.

## Out of scope

The capability resolver's semantics (`all`, `plugin:<name>`, `isolate`). It is already the
authoritative module; this spec feeds it one honest list.
