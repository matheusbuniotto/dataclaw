# 06 · Two plugin paths, one module

**Status:** `done` · **Strength:** Speculative · **Seam:** ports & adapters · **Size:** S

## Problem

The plugin module the eval pipeline uses has no runtime caller. The agent's tool bridge re-implements
MCP connection handling with a different timeout and its own error strings, so the same manifest and
the same server are started two ways with two policies.

## Evidence

| Path | Where | Consumers |
| --- | --- | --- |
| Capability | `src/plugins/registry.ts:33` `resolveCapability` → `transports.ts:200` `openPlugin` | `evals/compare.ts:36`, `evals/calibrate.ts:170`, `tests/plugins.test.ts` — **no `src` caller** |
| Tool bridge | `src/plugins/agent-tools.ts:87` `createPluginAgentTools` → `McpPluginClient` | harness (`:120,251`), `feature-tools`, `plugins-api` |

| Divergence | Where |
| --- | --- |
| Timeout 120 s vs 60 s | `src/plugins/transports.ts:6` vs `src/plugins/agent-tools.ts:24` |
| Two error vocabularies | `PluginError` in `registry.ts` vs plain `Error` strings in `agent-tools.ts` |
| A legitimate script plugin is reported as an error on every open | `src/plugins/agent-tools.ts:113` |

There are two transports (MCP stdio, JSON script) and two consumers (evals, agent), so the seam is
real. What is missing is one module behind it.

## Proposed direction

One plugin module owns discovery, startup, timeout, tool listing, and invocation. The agent bridge
becomes a projection that turns the published tool list into durable tools; the eval pipeline
becomes a projection that resolves a capability id to a bound call. Both use the same client, the
same timeout, and the same error vocabulary.

## What changes for callers

- `createPluginAgentTools` stops constructing its own client.
- `resolveCapability` stops opening its own client; it asks the module.
- A script-only plugin is described as "capabilities only", not as an error.
- One timeout, configurable in one place.

## Wins

- Two timeouts → one.
- Startup errors reported once, in one shape.
- Evals and the agent agree about what a plugin is and how it fails.
- The unused module is deleted rather than kept beside a duplicate.
- One place to fix a transport.

## Open questions

- Take this only if the two paths genuinely need to diverge later (for example, if evals want a
  long-lived server while the agent wants lazy start). If they do not, this is a clean deletion with
  no new seam: collapse into whichever module survives.
- Lazy start is load-bearing for the eval CLI (it must not start every plugin to compare two runs).
  The surviving module has to support both eager and lazy startup behind one interface.

## Acceptance

- One plugin manifest, started from the agent and from `evals:compare` in the same process,
  reports the same tools and the same timeout.
- A plugin that fails to start produces one message, and both consumers see it.
- A script-transport plugin is listed as capabilities-only rather than as an error.
- `resolveCapability` has no client construction of its own.

## Out of scope

The capability contracts (`stats.compare_eval_runs@1`, `stats.agreement_kappa@1`) and their
`parseOutput` rules. Those are the eval pipeline's business.
