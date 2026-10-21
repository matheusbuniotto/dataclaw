# Specs & roadmap

Deepening opportunities found by walking the codebase, kept here so they survive the review that
produced them. Each spec names a **seam** that is in the wrong place, the **module** that should
sit at it, and the tests that would prove the change.

The report these came from used the vocabulary in `.agents/skills/codebase-design/SKILL.md`
(module, interface, depth, seam, adapter, leverage, locality). Nothing is designed yet: the specs
describe a direction, not an interface. The interface gets designed when someone picks a candidate
up (see [Picking one up](#picking-one-up)).

## Status

| Status | Meaning |
| --- | --- |
| `proposed` | Direction recorded, nothing decided. |
| `exploring` | Someone is designing the interface and the cut. |
| `accepted` | Shape agreed; ready to implement. |
| `in progress` | Implementation started. |
| `done` | The seam moved and the acceptance tests exist. |
| `dropped` | Deliberately not doing it; record why. |

Every spec starts at `proposed`.

## Roadmap

| # | Candidate | Strength | Seam | Size | Depends on | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [01](01-data-source-session.md) | Put the live data source behind one seam, with providers for new data MCPs | Strong | ports & adapters | L | — | `in progress` |
| [02](02-transcript-read-model.md) | One transcript read model | Strong | in-process | M | — | `proposed` |
| [03](03-tool-inventory.md) | Derive the tool inventory | Strong | in-process | S | — | `proposed` |
| [04](04-console-api.md) | Give the console one HTTP seam | Worth exploring | ports & adapters | M | 02 (snapshot), 03 (catalog) | `proposed` |
| [05](05-document-writes.md) | One writer for the durable documents | Worth exploring | in-process | S–M | 01 (plan record) | `proposed` |
| [06](06-plugin-startup.md) | Two plugin paths, one module | Speculative | ports & adapters | S | 01 (transport) | `proposed` |

**Size** is the shape of the change, not a deadline: S ≈ one module plus its tests, M ≈ a module
plus its call sites, L ≈ a subsystem.

## Recommended order

1. **01 · data source session.** Every tool call crosses this seam, it holds the most reachable
   shared state, and it is the one that decides how Snowflake or BigQuery gets added later. Accepted
   2026-10-21: a per-conversation session, providers declared by manifest, dialects in code, seven
   source-neutral tools. Steps: [01-plan.md](01-plan.md).
2. **03 · tool inventory.** Cheap, independent, and it fixes a user-visible lie: the capabilities
   page currently shows 11 analyst tools, four of which belong to the Databricks group, and omits
   17 tools that are installed.
3. **02 · transcript read model.** Largest testability win. Unblocks 04.
4. **05 · document writes.** Small, and it removes a real collision (a workflow run appends
   `find-1` again) once 01 has fixed where the plan record is written.
5. **04 · console HTTP seam.** Worth doing, but it mostly moves code that 02 and 03 will have
   already reshaped.
6. **06 · plugin startup.** Speculative: only take it when the eval pipeline and the agent
   genuinely diverge in behaviour, not just in code.

## Picking one up

For the chosen candidate, settle these before writing code:

- **Constraints.** What does `pi-durable` already give us (tool execution context, registry
  snapshot, document transactions) and where does it refuse to help?
- **The shape.** What does a caller have to know? If the answer is more than a handful of verbs,
  the cut is wrong.
- **What sits behind the seam.** Which of the current responsibilities move in, and which stay
  outside. Name the ones that stay; they are the boundary of the change.
- **Which tests survive.** A deepening is not done if the existing tests all have to be rewritten:
  that means the seam moved underneath the tests rather than around them.
- **Domain names.** If the deepened module is named after a concept the project does not have yet,
  add it to `GLOSSARY.md` (there is none today) before coding. If a candidate is rejected for a
  load-bearing reason, record it as an ADR under `docs/adr/` so the next review does not
  re-suggest it.

## Definition of done

- The seam the spec names has exactly one module behind it, and the call sites that used to
  coordinate by hand no longer do.
- The acceptance tests in the spec exist and fail without the change.
- The duplicated knowledge the spec lists is deleted, not commented out or left behind a flag.
- `bun test` is green. `bun run evals` still runs, since three of these touch paths it crosses.

## Deliberately not in this roadmap

Observations from the same walk that are cleanup, a bug, or a product decision rather than a
deepening. Fix them directly; they do not need a spec.

- `AgentsPage.tsx` ships fabricated state that reaches the real API: three phantom teammates
  (`churn-analyst`, `databricks-explorer`, `quality-auditor`), invented routines, a fake shell log,
  and a model id (`Pi / Claude 3.5 Sonnet`) that no provider resolves.
- `src/prototype/console.css` is imported nowhere; `index.html` carries a second copy of its rules.
- Starter prompts are duplicated between `DurableAgentConsole.tsx:54` and `AgentsPage.tsx:191`.
- `getSharedAdapter()` has no callers.
- The `beforeTool` SQL guard in `analyst-extension.ts` is a weaker duplicate of
  `isReadOnlySql()`; it blocks a legitimate `WHERE note = 'UPDATE'` and misses `MERGE`/`CREATE`.
- `MAIN_AGENT_INSTRUCTIONS` and `workspace/templates/AGENTS.md` describe the same workflow twice.
- Two plugin timeouts (60 s vs 120 s) are folded into 06 rather than tracked separately.

## Provenance

Written 2026-10-21 from two codebase walks (runtime core, then console/entry points/evals) weighted
toward the most recently changed areas: the plugin and capability work, the eval harness, and agent
profiles. The rendered review was written to the OS temp directory and is not checked in.
