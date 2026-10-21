# hypothesis-testing-playbook

An Agent Skill that runs A/B tests and agent-eval comparisons by the book, on top of a hypothesis-testing MCP server built with the tea-tasting Python library.

It covers the order of work (design, power, wait, SRM check, analyze, report) and the judgment around it:

- A pre-registration checklist: hypothesis, primary metric, guardrails, unit, alpha, direction, MDE, sample size, stop date, analysis plan, multiple-testing plan.
- No peeking: the agent will not read the primary metric before the planned sample, unless the test was pre-registered as sequential (mSPRT), and has a script for when the user insists.
- Randomization unit declared when analysis rows are finer than the randomized unit; segments kept exploratory.
- SRM blocks interpretation.
- Effect sizes with confidence intervals; "not significant" reported as inconclusive, not as "no effect".
- Delta method for ratio metrics, CUPED, Holm or BH corrections, winsorizing with Yuen's trimmed t-test, and quantile or bootstrap metrics, all decided before launch.
- Agent v1 vs v2: repeated runs on the same cases, compared paired (analytic or cluster bootstrap), with run-to-run noise and the seed reported.
- No invented numbers: every figure in a report comes from a tool output.

## What's inside

| File | Purpose |
|---|---|
| `SKILL.md` | Seven steps with completion criteria |
| `references/interpretation-pitfalls.md` | Pitfalls with reusable sentences |
| `references/tool-contract.md` | Expected MCP tools and fallbacks |
| `assets/PREREGISTRATION_TEMPLATE.md` | Plan template |
| `assets/REPORT_TEMPLATE.md` | Stakeholder and technical reports |

## Requirements

The MCP server exposing `design`, `power`, `analyze`, `srm_check`, `sequential_check`, `compare_eval_runs`, and `report` (tea-tasting-tools). Without it the skill still guides the process but reports no statistics.

## Install

Copy the `hypothesis-testing-playbook/` folder into a skills directory:

| Agent | Project-level | Personal |
|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Cursor | `.cursor/skills/`, `.agents/skills/`, or `.claude/skills/` | `~/.cursor/skills/` |
| GitHub Copilot (VS Code agent mode, CLI, cloud agent) | `.github/skills/`, `.agents/skills/`, or `.claude/skills/` | `~/.copilot/skills/` |

## Use

- "Help me plan an A/B test for the new onboarding flow."
- "We're halfway through and p = 0.02. Can we ship?"
- "Set this test up as sequential so we can stop early."
- "The test finished. Write the stakeholder report."
- "Is agent v2 better than v1 on our eval set?"

## Author

Matheus Buniotto, author of aprendaevals.com.br.
