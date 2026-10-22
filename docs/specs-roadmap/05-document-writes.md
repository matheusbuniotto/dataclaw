# 05 · One writer for the durable documents

**Status:** `done` · **Strength:** Worth exploring · **Seam:** in-process · **Size:** S–M

**Depends on:** 01 (who writes the plan's connection record).

## Problem

Four modules append to `FindingsDoc` and three write fields on `AnalystPlanDoc`. Finding ids are
allocated as `find-${length + 1}` in one module and hardcoded as `find-1` / `find-2` in another, so
a workflow run can collide with a tool-recorded finding. The audit invariant — only the auditor
confirms a finding — is written down in prose and broken by the saga.

## Evidence

| Where | What |
| --- | --- |
| `src/tools/analyst-tools.ts:293` | `record_finding`; id is `find-${findings.findings.length + 1}` |
| `src/subagents/auditor-subagent.ts:14` | `parseAuditVerdict` reads `VERDICT:` |
| `src/subagents/auditor-subagent.ts:117` | writes `audited`, `auditVerdict`, `auditNotes` |
| `src/tasks/analysis-workflow.ts:134,154` | hardcodes `id: "find-1"` and `id: "find-2"` |
| `src/tasks/analysis-workflow.ts:205` | sets `auditVerdict = "confirmed"` from the saga, with a note admitting it skipped the auditor |
| `src/tools/analyst-tools.ts:103`, `src/tools/databricks-tools.ts:327`, `src/tasks/analysis-workflow.ts:43` | `plan.activeDataset` written three times |
| `src/harness.ts:205`, `src/tools/databricks-tools.ts:150`, `src/prototype/workspace.ts:148` | `plan.databricks` written three ways |

A second run of `AnalysisWorkflowTask` against the same conversation appends a duplicate `find-1`
and `find-2`; `request_auditor_review` then audits whichever one `find` returns first.

## Proposed direction

One document-write module owns the mutations that carry an invariant:

- appending a finding, with id allocation in one place;
- attaching an audit verdict, so the only way to set `audited` is from an auditor result;
- recording the active dataset;
- recording the connection (moved into 01's session, which then calls this module).

The tools, the auditor subagent, the workflow saga, and the console call it. The saga either calls
the same writers or is deleted; today it is a second implementation of the analysis loop with a
scripted audit, registered in the production extension and reachable from the CLI.

## What changes for callers

- `record_finding` describes the finding; it does not compute an id.
- `request_auditor_review` hands the verdict to the writer; it does not edit the array itself.
- The saga stops inventing ids and verdicts. If it keeps its scripted audit, it must mark it as such
  in the document rather than as `confirmed`.
- `AgentsPage` / the console read the same shapes the tools write.

## Wins

- Id allocation exists once; a saga run can no longer collide with a tool call.
- "Only the auditor confirms" becomes enforceable in code, not prose.
- The plan's dataset and connection fields have one writer each.
- Locality: a finding's invariants live with the finding.
- Small change, real bug removed.

## Open questions

- Is `AnalysisWorkflowTask` worth keeping? It hardcodes churn columns (`plan_tier`, `churned`,
  `support_tickets_30d`) behind a `filePath: string` interface, and the CLI defaults to exactly the
  one file it fits. Deleting it removes 249 lines and a demo; keeping it means it must go through
  the writers. Decide here rather than leaving both.
- Confidence values are magic numbers in four places (0.92, 0.95, 0.9, 0.85) with no shared policy.
  Out of scope, but the writer is the natural place to put a default if one is ever chosen.

## Acceptance

- Recording a finding after a saga run yields a fresh id, never a duplicate.
- A finding cannot reach `audited: true` except through the auditor write path.
- The three `plan.activeDataset` call sites produce byte-identical document shapes.
- One test runs the saga twice in one conversation and asserts two findings, two distinct ids, and
  no `confirmed` verdict from the saga.

## Out of scope

`PlaybookDoc` and `TelemetryDoc`. Their writers are single-call-site today; fold them in only if
they grow a second one.
