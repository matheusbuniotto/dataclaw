---
title: DataClaw
emoji: 🦀
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# DataClaw 🦀

[![Bun](https://img.shields.io/badge/runtime-Bun%20v1.2+-000000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/types-TypeScript%20strict-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-309%20passing-10B981)](bun%20test)
[![Pi Durable](https://img.shields.io/badge/engine-Pi%20Durable%201.3-6366F1)](https://github.com/earendil-works/pi-durable)
[![Storage](https://img.shields.io/badge/storage-SQLite%20WAL%20(crash--resilient)-003B57?logo=sqlite)](https://sqlite.org)
[![Lakehouse](https://img.shields.io/badge/lakehouse-Databricks%20Unity%20Catalog%20MCP-FF3621?logo=databricks)](https://docs.databricks.com)
[![Observability](https://img.shields.io/badge/observability-LangWatch%20%2B%20Evals-06B6D4)](src/observability/langwatch.ts)

**DataClaw** is a definitive open-source data analytics agent architecture engineered specifically for **long-running, crash-resilient investigations**. 

> 🔬 **Architecture & Statistical Deep-Dive**: See [**docs/ARCHITECTURE_DOSSIER.md**](docs/ARCHITECTURE_DOSSIER.md) and [`docs/architecture.excalidraw`](docs/architecture.excalidraw) for the complete engineering dossier, clustered statistical rigor, LangWatch tracing, and failure post-mortems. Run `bun run showcase` for the live 45-second terminal demonstration. 
> 
> 🚀 **Deploy on Databricks Apps**: See [**docs/DATABRICKS_APPS.md**](docs/DATABRICKS_APPS.md) for 1-click Databricks Asset Bundle (DAB) deployment, Unity Catalog Volume persistence, and Service Principal M2M authentication. 

Unlike conventional conversational assistants that lose context upon process restarts, jump to spurious statistical conclusions, or burn tokens in endless SQL syntax loops, DataClaw operates as a stateful, disciplined analytical partner:
- **Resilient Durability**: Every analytical hypothesis, SQL execution trace, finding, and institutional playbook rule is atomically checkpointed to SQLite WAL. Machine restarts, container cycles, or host crashes seamlessly resume from their exact checkpoint without re-querying datasets.
- **Statistical Skepticism**: Every analytical finding is cross-examined by an autonomous, skeptical **Auditor Subagent** to guard against p-hacking, small sample distortions ($N < 30$), confounding variables, and Simpson's Paradox before being presented.
- **Source-Neutral Data Engine**: Seamlessly inspects and queries local tabular files (CSV, TSV, JSON, JSONL/NDJSON) as well as enterprise cloud lakehouses (Databricks Unity Catalog over streamable HTTP MCP, with Snowflake and BigQuery dialects).
- **Closed-Loop Auto-Improvement**: Post-session reflections, reviewer ratings, and auditor pushback are distilled into versioned institutional playbooks injected into subsequent system prompts.
- **Executive Intelligence Reporting**: Exports full stakeholder briefings with verified statistical evidence, confidence levels, and SQL audit trails into Markdown, self-contained HTML memos, or structured JSON.
- **Meta-Agent Roster & Sandboxed Compute**: Spawns specialist agents (Data Scouts, Code Executors, Reviewers) with isolated local homes or Docker containers with scale-to-zero lifecycle.

Built with [Pi Durable](https://github.com/earendil-works/pi-durable) and [Bun](https://bun.sh).

---

## The Core Problem: Why Long-Running Data Assistants Fail

When building autonomous AI agents for data analysis, teams encounter five fundamental failure modes that naive LLM wrapper scripts cannot solve:

| Failure Mode in Naive Agents | Root Cause | DataClaw Solution |
| :--- | :--- | :--- |
| **Amnesia & Lost Progress** | Process terminations, container recycling, or token window saturation wipe conversational state. | **Pi Durable SQLite Checkpoints**: Sagas (`AnalysisWorkflowTask`) and durable documents (`AnalystPlanDoc`, `FindingsDoc`, `PlaybookDoc`) commit state atomically to SQLite WAL. Resumes via `harness.resume()`. |
| **Statistical Hallucination & P-Hacking** | LLMs are eager to confirm user biases and report spurious correlations, small sample noise ($N < 10$), and Simpson's Paradox. | **Task-Owned Auditor Subagent**: A skeptical critic subagent reviews every finding before confirmation (`request_auditor_review`), calibrated blindly against human ground-truth labels using Cohen's kappa. |
| **Runaway Query Loops & Token Drain** | Agents hitting SQL syntax errors repeatedly retry identical queries or run unbounded steps. | **Production Stuck Detection**: Real-time detectors flag `repeated_call` (>= 3), `error_streak` (>= 3), `tool_budget` (> 25), and `no_final_answer` across offline and production traces. |
| **Warehouse Lock-in & Mutation Risk** | Writing database-specific tools risks code pollution and accidental destructive mutations (`DROP`/`DELETE`). | **Read-Only Data Source Sessions**: One unified session interface across local in-memory SQLite and Databricks MCP. Rejects mutating SQL at dialect, adapter, and session boundaries. |
| **Institutional Amnesia** | Agents repeat the same analytical mistakes session after session. | **Continuous Playbook Auto-Improvement**: Captures feedback and reflections into `TelemetryDoc`, running `AutoImprovementTask` to synthesize Version $N+1$ heuristics dynamically injected into future system prompts. |

---

1. **Is the answer right?** Reading the reply doesn't tell you. The number has to be checked against the data.
2. **Did it get stuck along the way?** An agent that re-runs the same query five times, or keeps hitting SQL
   errors, burns tokens and the user's time even when it gets there in the end.
3. **What did a correct answer cost?** Cost per run hides failures. The useful number is cost per *successful*
   answer.

The agent already records what's needed to answer all three: every tool call with its arguments, result, error flag,
and duration; token usage per model call; and each finding with the auditor's verdict. `evals/` reads those records.
It doesn't add any new logging.

## Method

**Tasks.** [`evals/tasks.ts`](evals/tasks.ts) has nine questions about the two sample datasets ("What share of
Basic tier customers churned?", "Which incident lasted the longest?"). Each one has a reference SQL query, and the
expected answer is computed by running that query on the data, so ground truth can't drift from the data. The agent
must end its reply with `ANSWER: <value>`. Numbers are graded within 1% (2% for the correlation task), and a
proportion is also accepted written as a percentage.

**Trace.** [`evals/trace.ts`](evals/trace.ts) flattens the stored transcript into tool calls (name, canonical
arguments, error flag, duration), the final reply, and the findings with their audit verdicts.

**Stuck detector.** A run counts as stuck if any of these is true. None of them needs ground truth, so the same
detector works on production traces:

| Signal | Definition (defaults) |
| --- | --- |
| `repeated_call` | the same tool with the same arguments, 3 or more times |
| `error_streak` | 3 or more tool errors in a row |
| `tool_budget` | more than 25 tool calls |
| `no_final_answer` | the run ends with no text reply, or with a provider error or abort |

There's a separate quality flag for runs that *answered after the auditor rejected their finding* and never recorded
a revised one.

**Metrics** ([`evals/report.ts`](evals/report.ts)):

- success rate
- tasks solved in every repeat and in any repeat
- spread of the success rate across repeats
- flaky tasks
- stuck rate, and success with and without being stuck
- tool error rate
- tokens per run
- cost per successful answer
- latency p50 and p90

**Statistics** ([`evals/stats.ts`](evals/stats.ts), no dependencies, seeded):

- Repeats of the same task are correlated, so confidence intervals come from a percentile bootstrap that resamples
  *tasks*, not runs.
- Comparing two variants adds:
  - a sample ratio mismatch check (chi-square against the planned split)
  - the success-rate difference with a Newcombe interval and a task-paired bootstrap interval
  - Cohen's h as the effect size
  - bootstrap intervals on the stuck-rate and cost-per-success differences
- `tests/evals.test.ts` checks these functions against published values (Newcombe 1998, chi-square critical
  values, a textbook kappa).

**Judge calibration.** The auditor is DataClaw's LLM-as-judge: it rates each finding as confirmed, caution, or
rejected. A judge is only worth trusting once it agrees with people. [`evals/calibrate.ts`](evals/calibrate.ts)
works in two steps:

1. It exports every audited finding to a CSV *without* the auditor's verdict, so labeling is blind.
2. It joins the human labels back and reports raw agreement, a confusion matrix, and Cohen's kappa with a bootstrap
   CI.

**Two modes.**

- `bun run evals` runs offline. It uses the real harness, tools, SQLite engine, and auditor subagent, but the model
  is a scripted agent ([`evals/scripted-agent.ts`](evals/scripted-agent.ts)). The script reads its answer out of the
  tool result it receives, and it fails at fixed, injected rates: it skips profiling, writes a SQL typo, loops on the
  same query, records a finding without its query, or misreports the number.
- `bun run evals --model <provider>/<model>` runs a real model through the same pipeline.

## Results

### 1. Four bugs found while building the evals (real)

The first and third showed up as failed eval runs. The other two came up while reading the code the trace depends
on. Each fix has a test.

| Bug | Effect | Fix |
| --- | --- | --- |
| Tools returned results under `content`, which Pi Durable 1.3 ignores | **The model never saw a query result, profile, metric, or audit report.** It only saw progress lines like "Executing query: …" | return `output` ([tests/tool-output.test.ts](tests/tool-output.test.ts)) |
| Tool errors were returned as normal text | SQL errors were invisible in the trace as errors | set `isError` |
| `record_finding` wrote `query: undefined` when the model left out the optional query | the call failed and the finding was lost | only set optional fields when they're present |
| The audit verdict was matched with `/REJECTED/` anywhere in the reply, and defaulted to confirmed | a reply that echoed the `[CONFIRMED \| CAUTION \| REJECTED]` template counted as rejected, and an empty reply counted as confirmed | read the `VERDICT:` line, and treat a reply without one as caution |

I measured the first two by running the same offline eval (same seeds, same injected faults) on the original commit:

| | original commit `a97316a` | this branch |
| --- | --- | --- |
| Scripted-agent success (90 runs) | 0 / 90 | 79 / 90 |
| Tool error rate, baseline variant | 1.9% | 5.3% |

The scripted agent copies its answer from the query result, so 0/90 means the result never reached it. A real model
would have had to make up every number. The tool error rate went *up* after the fix because injected SQL errors
became visible.

To reproduce the left column:

```bash
git worktree add ../dataclaw-before a97316a
cp -r evals ../dataclaw-before/
cd ../dataclaw-before && bun install
bun run evals/run.ts --out /tmp/before
```

### 2. Offline eval report (synthetic: scripted agent, injected faults)

> These numbers check the measurement pipeline. They don't measure any model. `candidate` is the same script with
> lower injected rates for looping, skipped profiling, and unsupported claims. Costs use a nominal price: $0.50 per
> million input tokens, $2 per million output tokens, and $0.05 per million cache-read tokens. Reproduce with
> `bun run evals`. Every number except latency is deterministic. Full report:
> [evals/results/scripted-report.md](evals/results/scripted-report.md).

| Metric | baseline | candidate |
| --- | --- | --- |
| Runs (tasks × repeats) | 45 (9 × 5) | 45 (9 × 5) |
| Success rate [95% CI] | 84.4% [71.1%, 95.6%] | 91.1% [82.2%, 100.0%] |
| Tasks solved in every repeat | 44.4% | 66.7% |
| Success rate by repeat (min–max) | 77.8%–88.9% | 77.8%–100.0% |
| Stuck rate [95% CI] | 26.7% [13.3%, 40.0%] | 2.2% [0.0%, 6.7%] |
| Success when stuck / not stuck | 50.0% / 97.0% | 100.0% / 90.9% |
| Answered despite a rejected finding | 11.1% | 0.0% |
| Cost per success [95% CI] (nominal) | $0.0113 [$0.0103, $0.0131] | $0.0107 [$0.0099, $0.0119] |

| candidate vs baseline | Result |
| --- | --- |
| Sample ratio check | 45 vs 45, p = 1.00 |
| Success difference, task bootstrap 95% CI | +6.7 pp [−11.1 pp, +24.4 pp] |
| Cohen's h | 0.21 |
| Stuck-rate difference, task bootstrap 95% CI | −24.4 pp [−40.0 pp, −8.9 pp] |

What this shows about the method (not about a model):

- **Nine tasks with five repeats each can't detect a 7-point gain in success rate.** The interval runs from −11 to
  +24 points. The same set does detect the change in stuck rate, because looping is a frequent, direct signal.
  Run `bun run evals:power` to calculate intra-cluster correlation (ICC = 0.150) and evaluate whether an experiment
  is sufficiently powered to ship to production (requires 289 tasks for a +5 pp MDE).
- **Agent quality fuels growth.** Run `bun run evals:growth` to model how stuck rate reductions translate directly into
  funnel activation (+23.3 pp), Day-30 retention (+17.6 pp), and projected ARR (+$1.6M per 10k users).
- **Repeats matter.** Every task was solved at least once in both variants, but fewer than half (baseline) or two
  thirds (candidate) were solved in every repeat. A single run per task would have overstated reliability.
- **The stuck detector can't see confident wrong answers.** The candidate's failures are all misreported numbers,
  which is why its "not stuck" success rate is below 100%. Catching those needs ground truth offline, and a
  calibrated judge online.
- In this offline setup, the stub auditor confirms findings that cite a query even when the number is wrong. That's
  the kind of judge blind spot the calibration step exists to measure on real labels.

### 3. Real-model results: not run yet

No model credentials were available where this report was produced, so there are no real-model numbers here. To
produce them:

```bash
# any provider Pi knows: opencode-go, openai, anthropic, google, openrouter
export OPENAI_API_KEY=...            # or log in with pi
bun run evals --model openai/gpt-4o --repeats 3
# writes evals/results/model-openai_gpt-4o.jsonl and a report next to it

# compare two models or prompts run on the same tasks
bun run evals:report evals/results/model-A.jsonl evals/results/model-B.jsonl

# calibrate the auditor: export, label human_label as confirmed/caution/rejected, score
bun run evals:calibrate export evals/results/model-openai_gpt-4o.jsonl > labels.csv
bun run evals:calibrate score labels.csv evals/results/model-openai_gpt-4o.jsonl
```

**Plugins.** Statistics can also come from an external plugin, for example a Python service
on a stats library. `bun run evals:compare a.jsonl b.jsonl` compares two runs (cases = tasks,
runs = repeats) through whichever installed plugin provides `stats.compare_eval_runs@1`, and
`evals:calibrate score` also asks a `stats.agreement_kappa@1` plugin. Without one, both use the
built-in code above. Plugins are declared by a small manifest and speak MCP over stdio or plain
JSON on stdin/stdout. Stats is the first domain; ML, forecasting or FP&A plugins use the same
mechanism.

An installed MCP plugin also hands its tools to the analyst agent: each MCP tool becomes a
durable agent tool named `<plugin>__<tool>`, deferred behind `tool_search`, with the schema the
server publishes. Adding a tool to a plugin needs no DataClaw change. See
[docs/plugins.md](docs/plugins.md) and [docs/capabilities/stats.md](docs/capabilities/stats.md).

`evals/labels/auditor-labels.example.csv` shows the label format. Its labels are placeholders produced by a rule
(rejected if the finding has no query or a wrong number) and are marked `EXAMPLE`. The score command prints a
warning when it sees them.

## Limitations

- The task set is nine questions on two toy datasets, which is too small for any claim about a model.
- The offline numbers come from a scripted agent. They show that the metrics compute correctly, not that any agent
  is good.
- The stuck thresholds (3, 3, 25) are defaults I picked, not tuned against labeled sessions.
- Latency in offline mode is local wall clock and isn't comparable across machines.
- `bun run typecheck` (`tsc --noEmit`) verifies 0 compiler errors across the entire codebase. `bun test` runs 292 passing tests across 34 suites in under 4 seconds.

---

# The agent

## Architecture

```mermaid
flowchart TD
    subgraph Storage ["Durable Persistence Layer (SQLite / WAL)"]
        PlanDoc["AnalystPlanDoc\n(Hypotheses, Goals, Milestones)"]
        FindingsDoc["FindingsDoc\n(Verified Findings, Audit Verdicts)"]
        PlaybookDoc["PlaybookDoc\n(Learned Rules, Heuristics, Anti-Patterns)"]
        TelemetryDoc["TelemetryDoc\n(Feedback, Durations, Ratings)"]
        RosterDoc["AgentRosterDoc\n(Specialists, delegated runs)"]
    end

    subgraph AgentLoop ["Pi Durable Agent Runtime"]
        Extension["AnalystExtension"]
        Sections["Dynamic Prompt Sections\n(Plan, Findings, Playbook vX)"]
        Tools["Durable Analyst Tools\n(Profile, Query, Correlate, Reflect)"]
    end

    subgraph Tasks ["State Machine Sagas (defineTask)"]
        AnalysisTask["AnalysisWorkflowTask\n(Intake -> Profile -> Hypothesize -> Query -> Audit -> Memo)"]
        ImproveTask["AutoImprovementTask\n(Scan Telemetry -> Distill Patterns -> Upgrade Playbook vX+1)"]
    end

    subgraph Subagents ["Task-Owned Subagents"]
        Auditor["Auditor Subagent\n(Rigorous Statistician, Challenges Bias)"]
    end

    subgraph Warehouse ["Databricks (MCP)"]
        MCP["Databricks SQL MCP Server\n/api/2.0/mcp/sql"]
        UC["Unity Catalog\n(catalog.schema.table)"]
    end

    Extension --> Sections
    Sections --> AgentLoop
    AgentLoop --> Tools
    Tools --> Storage
    Tools --> MCP
    MCP --> UC
    Tasks --> Storage
    Tools --> Tasks
    Tools --> Subagents
    ImproveTask --> PlaybookDoc
```

## Capabilities

### Exploratory Data Profiling & SQL Engine
- Safe, sandboxed read-only query execution across CSV, JSON, and SQLite datasets.
- Schema inference, null percentages, distinct values, and column distribution profiling.
- Built-in statistical calculations (Pearson correlation, percentile distributions).

### Crash-Resilience & Exactly-Once Durability
- Atomic SQLite commits ensure no data loss during machine restarts, host crashes, or network interruptions.
- Idempotent request IDs and task states allow tasks to resume from their exact checkpoints using `harness.resume()`.

### Closed-Loop Auto-Improvement (Institutional Memory)
- **Continuous Feedback Capture**: Stores post-mortem self-reflections, auditor corrections, and human reviewer feedback ratings (1-5 stars) in `TelemetryDoc`.
- **Durable `AutoImprovementTask`**: A multi-phase state machine that scans past telemetry, identifies recurring failure modes (e.g., small sample sizes, Simpson's paradox, unsegmented cohorts), and synthesizes new domain heuristics into `PlaybookDoc`.
- **Dynamic System Prompt Injection**: Upgraded playbook rules (e.g. Version 2, Version 3) are injected directly into the LLM system prompt via `section("auto_improving_playbook")` on every subsequent turn!

### 🤖 4. Meta-agent roster and agent profiles
DataClaw is the coordinator. From the same chat the user can create, update, archive, and delegate specialists. The roster is a session-scoped durable document, so it survives restarts.

- `agents_create` adds a persistent agent. Roles: `coordinator`, `researcher`, `writer`, `reviewer`, or `custom` with instructions. Each agent gets its own conversation.
- A profile is more than a role: `instructions` (persona), `background` (inline knowledge), `contextFiles` (workspace/project text files), `skills` (a subset of the available list), `capabilities`, an optional `model`, and `compute`. This is the Grokbot-style “bot with its own context, tools, and computer” shape.
- Capabilities are names, resolved against the live registry per turn: `analyst`, `databricks`, `coding`, `plugins`, `roster`, `features`, `all`, `plugin:<name>`, or an explicit tool name. The smallest set wins: a writer with `analyst` + `coding` gets neither Databricks nor roster tools.
- The `agent_profile` prompt section injects the specialist's background and the contents of its knowledge files; `available_skills` is filtered to the profile's skills. Both are read each turn, so editing a file or a skill does not need a new agent.
- `agents_inspect` shows the full profile. `agents_update` changes persona, knowledge, capabilities, skills, model, or status. `agents_archive` retires one; restoring sets status back to `active`.
- `spawn_agent` delegates a task and waits. `mode: run` (the default) is an isolated subagent whose answer comes back into this chat. `mode: session` continues that agent's own conversation.
- A spawned run cannot create further agents or extend DataClaw. Fixed specialists (researcher, writer, reviewer) cannot be widened into managers; a custom agent may ask for `roster`.
- `bun run cli agents` lists the roster with each profile's capabilities and context. The console's sidebar and chat header have an **active-agent picker**: selecting a specialist switches the transcript, plan, findings, and the `/api/agent/ask` target to that conversation. The context chips are clickable too; the picker choice is kept in the URL (`?agent=<id>`) and remembered in `localStorage`.

### 🧩 4.1 Self-extension: DataClaw creates its own features
A skill is instructions; a plugin is executable capability. The meta-agent can build both and install them without a restart.

- `features_list` shows the tool groups, installed plugins, workspace skills, and plugin errors. It is the first call before building anything.
- `features_create_skill` writes `workspace/skills/<name>/SKILL.md`. Skills are visible on the next turn and can be assigned to an agent with `agents_update skills`.
- `features_create_plugin` writes `plugins/<name>/plugin.json` plus optional source files (`files: [{ path, content }]`). The plugin is an MCP server over stdio, or a script transport for a single capability. It is not started yet.
- `features_apply` starts newly installed plugins, installs their tools as `<plugin>__<tool>`, removes plugins that are gone, and reconfigures every roster agent against the new registry. A plugin that cannot start is reported; it does not take the agent down.
- `features_remove_skill` and `features_remove_plugin` retire what DataClaw installed. The plugin path is confined to `plugins/<name>/`; a manifest from `dataclaw.plugins.json` or `DATACLAW_PLUGIN_PATH` is never deleted by the agent.
- Nothing is claimed as installed until `features_apply` returns its tools. This is the difference between writing a manifest and having a capability.

### 🖥️ 4.2 Per-agent compute
Each specialist can have its own compute instead of sharing DataClaw's workspace:

- `compute: "local"` is the default for new specialists. The agent gets `workspace/agents/<id>/`, created on first use with a `memory/` folder. `read`, `write`, `edit` and `bash` operate there, so two specialists do not overwrite each other's files. The shell is still the host process: files are isolated, but this is not a security boundary.
- `compute: "docker"` uses the same private home, bind-mounted into a per-agent container. `bash` runs inside the container; file tools use the bind mount. The project root is mounted read-only so agents can still read `sample-data/`. The container gets `--cap-drop ALL`, `no-new-privileges`, memory/CPU/pid limits, and `--network none` by default (set `network: "bridge"` when the agent needs the internet).
- `compute: "shared"` keeps the old behavior (the workspace root). Existing agents migrate to `shared`; only new agents default to `local`.
- The conversation cwd is the compute home, so paths are identical on the host and inside a Docker container. The `agent_profile` prompt section states the compute and its path on every turn.
- Docker is opt-in and fails soft: if the daemon is unavailable, DataClaw logs the reason and runs the agent in its private local home. Configure the image and ceilings with `DATACLAW_COMPUTE_IMAGE` (default `oven/bun:1`), `DATACLAW_COMPUTE_MEMORY` (default `2g`), `DATACLAW_COMPUTE_CPUS` (default `2`), and `DATACLAW_COMPUTE_PIDS` (default `2048`).
- **Scale to zero:** a Docker container is stopped after 15 idle minutes (`DATACLAW_COMPUTE_IDLE_MS`, `0` disables). The home stays on disk, and the next `bash` call wakes the container with `docker start` before executing, so the stop is invisible except for a short first-command delay. On startup, once per project per process, DataClaw stops containers left running by a previous process (`DATACLAW_COMPUTE_SWEEP=off` disables this on a shared host). Containers carry a `dataclaw.project` label and a project hash in their name, so sweeping one checkout cannot stop another checkout's agents. Archived agents and agents moved off Docker are removed immediately.
- `src/compute/agent-compute.ts` owns the profile and home; `src/compute/docker-env.ts` is a small `ExecutionEnv` provider. E2B, Daytona, or a Kubernetes pod would implement the same contract: an `ExecutionEnv` whose `exec` runs remotely and whose file namespace matches the mounted home.

Example from chat:

```
Create a custom specialist called Sandbox Analyst.
Give it compute docker with network none, and capabilities analyst, coding.
```

Its files live in `workspace/agents/sandbox-analyst/`; `bash` runs in a container with that directory mounted writable and the rest of the project read-only.

### 🕵️ 5. Task-Owned Auditor Subagent
- Spawns a dedicated, skeptical statistical auditor subagent (`request_auditor_review`) owned by `api.taskId`.
- Scrutinizes findings for p-hacking, confirmation bias, confounding variables, or sample size deficiencies before claims are presented.

### 🧱 6. Databricks over MCP (Unity Catalog)
- Connects to the **Databricks-managed SQL MCP server** at `https://<workspace>/api/2.0/mcp/sql` over streamable HTTP.
- Authenticates with `DATABRICKS_HOST`/`DATABRICKS_TOKEN`, the local **Databricks CLI profile** (OAuth token refresh
  included), **browser OAuth** (authorization code + PKCE), or a **service principal** (client credentials).
- Exposes the source-neutral data tools: `connect_data_source` (with `provider: "databricks"`), `query_data`, `discover_data`, and `profile_table`. The same four work against any installed data source.
- **Read-only by construction**: the adapter selects `execute_sql_read_only`, rejects mutating SQL, and blocks multi-statement writes before anything reaches the warehouse.
- Profiles Unity Catalog tables with `DESCRIBE TABLE` plus one aggregate query (nulls, distincts, min/max/mean/median), and uses native `corr` / `percentile_approx` for statistics.
- The active connection is recorded in `AnalystPlanDoc.databricks` (host, MCP URL, profile, warehouse) so resumed runs know where the data came from. Tokens are never persisted.

## Quickstart

### Prerequisites
- [Bun](https://bun.sh) (v1.2+) or Node.js (v22+)
- (Optional) A model. DataClaw reads `.pi/settings.json`, then `~/.pi/agent/settings.json`, and the saved credential in `~/.pi/agent/auth.json`. This repo pins OpenCode Go:
  ```json
  { "defaultProvider": "opencode-go", "defaultModel": "deepseek-v4.1-flash" }
  ```
  `DEFAULT_MODEL_PROVIDER` and `DEFAULT_MODEL_ID` override that file. `OPENCODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY` are used when Pi has no credential for the provider. With none of these, the console stays on the offline faux model.

- (Optional) Databricks access for the Unity Catalog data source:
  ```bash
  # Either export workspace credentials...
  export DATABRICKS_HOST="https://dbc-xxxx.cloud.databricks.com"
  export DATABRICKS_TOKEN="dapi..."
  # ...or use a logged-in Databricks CLI profile (default: DEFAULT)
  databricks auth login --profile DEFAULT
  ```
  See `.env.example` for all Databricks variables.

### Run tests and evals
```bash
bun test
bun run evals          # offline, synthetic; see "Results" above
```

### Run Demonstration Scripts

1. **Auto-Improvement Loop Demo** (Shows Playbook upgrading from v1 to v2 based on feedback):
   ```bash
   bun run demo:auto-improve
   ```

2. **Crash Resilience & Resumption Demo** (Simulates mid-analysis process termination and recovery):
   ```bash
   bun run demo:resilience
   ```

3. **End-to-End Analysis Demo**:
   ```bash
   bun run demo
   ```

4. **Databricks over MCP Demo** (discovers catalogs, profiles a Unity Catalog table, runs a query):
   ```bash
   bun run demo:databricks
   # or target a table:
   bun run demo:databricks samples.nyctaxi.trips
   ```

### 🗄️ 7. Data sources: one session, many providers
The agent reaches data through one module, not through per-warehouse tools.

- One live source per conversation, recorded in `AnalystPlanDoc.dataSource` (host, endpoint, credential source — never a token). A restart reconnects from it.
- Seven source-neutral tools: `list_data_sources`, `connect_data_source`, `discover_data`, `profile_table`, `query_data`, `calculate_metric`, `load_dataset`. Adding a source adds no tool.
- Built-in providers: local CSV/JSON (with `load_dataset`) and Databricks. Every installed plugin with a `dataSource` manifest is a provider too.
- A dialect owns the SQL: `ansi`, `databricks`, `snowflake`, `bigquery`. Discovery, describe, the profile aggregate, percentiles and correlation all come from it, and every profile and metric reports `derivation` (`native` or `dialect:<name>`).
- Read-only fails closed: a manifest that names no read-only mode is refused at connect, and every statement is checked before it reaches the transport.
- **Adding Snowflake is a manifest plus an MCP server.** `tests/fixtures/plugins/fake-snowflake-mcp/` is the proof: it connects, discovers, profiles and queries with no change under `src/datasource/`. See [docs/specs-roadmap/01-data-source-session.md](docs/specs-roadmap/01-data-source-session.md).

---

## CLI

Run the built-in CLI against real tabular data:

```bash
# Analyze sample customer churn dataset
bun run cli analyze sample-data/customer_churn.csv "Identify primary churn indicators"

# Inspect the verified findings
bun run cli findings

# Generate an Executive Intelligence Briefing (Markdown, HTML, or JSON)
bun run cli report md
bun run cli report html ./executive_briefing.html

# Inspect active analytical plan & hypotheses
bun run cli plan

# Trigger the auto-improvement task
bun run cli auto-improve "retention_strategy"

# View the upgraded institutional playbook
bun run cli playbook

# List specialists created from chat
bun run cli agents
```

### Databricks commands

```bash
# Show the resolved workspace and MCP endpoint
bun run cli databricks-status

# Discover Unity Catalog assets
bun run cli databricks-catalogs
bun run cli databricks-schemas samples
bun run cli databricks-tables samples nyctaxi
bun run cli databricks-describe samples.nyctaxi.trips

# Profile a table (rows, nulls, distributions) and run read-only SQL
bun run cli databricks-profile samples.nyctaxi.trips
bun run cli databricks-query "SELECT pickup_zip, COUNT(*) FROM samples.nyctaxi.trips GROUP BY pickup_zip LIMIT 5"
```

The durable agent can attach Databricks on startup with `DATABRICKS_AUTO_CONNECT=true`, or at runtime by calling the
`connect_data_source` tool. In this repo, `.pi/mcp.json` also registers the same endpoint for pi sessions and subagents;
its bearer token is minted from `databricks auth token` at connect time, so run `/mcp reconnect databricks` if a long
session outlives the token.

> **Security:** only read-only SQL is allowed. `execute_sql_read_only` is preferred, mutating keywords are rejected,
> and multi-statement writes are blocked before the call leaves the process.

### Console auth UI

The console wraps Databricks authentication in a UI:

```bash
bun run console
# open http://localhost:3000/console/settings or /console/data
```

> The console script is `console` and the UI is served at `/console/*` (with `/prototype/*` supported for backward compatibility).

- The topbar **Connect Databricks** button (and Settings → Databricks Unity Catalog) opens the auth panel.
- **CLI profile** tab lists profiles from `~/.databrickscfg` and connects with the profile's OAuth token.
- **OAuth** tab offers two flows:
  - **Browser sign-in** — OAuth 2.0 authorization code + PKCE using Databricks' public `databricks-cli` client.
    It opens the workspace login page and completes on a short-lived `localhost:8020` callback, then refreshes
    tokens automatically. The console and browser must run on the same machine.
  - **Service principal** — OAuth client-credentials (M2M) for unattended agents. The service principal needs
    workspace access and the `sql` scope.
- **Access token** tab accepts a workspace URL + PAT for environments without a CLI login or OAuth app.
- Connected state shows the resolved identity (`SELECT current_user()`), visible catalogs, MCP endpoint, auth method,
  and token expiry, with **Refresh token** and **Disconnect** actions.
- The console server binds to `127.0.0.1` by default because the auth endpoints can mint warehouse sessions.
  Set `HOST=0.0.0.0` only if you intentionally want remote access.

The HTTP surface is intentionally small: `GET /api/databricks/status`, `POST /api/databricks/connect`,
`POST /api/databricks/reconnect`, `POST /api/databricks/disconnect`, `POST /api/databricks/oauth/start`,
`GET /api/databricks/oauth/status`, and `POST /api/databricks/oauth/cancel`.
Tokens and OAuth refresh tokens are held in server memory only.

> Restart `bun run console` after changing server routes. Bun's HMR reloads the React client, but a
> long-running server process keeps its existing route table.

## Project structure

```
dataclaw/
├── src/
│   ├── index.ts                     # Main entrypoint & public exports
│   ├── cli.ts                       # Interactive CLI runner
│   ├── config.ts                    # Multi-provider model configuration (OpenAI, Anthropic, Gemini, Faux)
│   ├── harness.ts                   # Bootstraps Harness, SQLite storage, registry, and resumption
│   ├── console/                     # DataClaw console (Bun.serve + React)
│   │   ├── api/                     # HTTP seam: routes, wire types, server, and the domain APIs
│   │   │   ├── server.ts            # Bun.serve: page routes + the API table
│   │   │   ├── routes.ts            # /api/* route table and respond()
│   │   │   ├── databricks-api.ts    # Server-side session manager for the auth UI
│   │   │   ├── capabilities-api.ts  # Toggle, install, remove, and apply capability changes
│   │   │   └── plugins-api.ts       # Read-only plugin inventory for the snapshot and Settings
│   │   ├── pages/                   # One module per page: overview, agents, runs, data, capabilities, settings
│   │   ├── components/              # Shared presentational pieces: chat, page chrome, auth, agent editor
│   │   ├── state/                   # workspace-types.ts, the shapes pages render
│   │   ├── styles/                  # base.css, chat.css, theme-lovable.css
│   │   └── DurableAgentConsole.tsx  # The shell: navigation, sidebar, and client route table
│   ├── capabilities/
│   │   └── catalog.ts               # dataclaw.capabilities.json: what is installed and what is off
│   ├── plugins/                     # Data plugins: MCP/script transports and capability contracts
│   │   ├── manifest.ts              # Discovery and validation of plugin.json
│   │   ├── transports.ts            # MCP over stdio, and JSON-per-call scripts
│   │   ├── registry.ts              # resolveCapability(): best provider for a capability id
│   │   ├── agent-tools.ts           # One agent tool per MCP tool, named <plugin>__<tool>
│   │   └── capabilities/stats.ts    # stats.compare_eval_runs@1, stats.agreement_kappa@1
│   ├── docs/                        # Durable Document Schemas (defineDoc)
│   │   ├── plan.ts                  # AnalystPlanDoc (active goal, hypotheses, milestones)
│   │   ├── findings.ts              # FindingsDoc (verified insights, evidence, audit verdicts)
│   │   ├── playbook.ts              # PlaybookDoc (learned heuristics, anti-patterns, templates)
│   │   ├── telemetry.ts             # TelemetryDoc (feedback ratings, error logs, reflections)
│   │   ├── agents.ts                # AgentRosterDoc (specialists, profiles, delegated runs)
│   │   └── agent-capabilities.ts   # Capability groups -> extensions and tool allowlists
│   ├── tools/                       # Replayable agent tools
│   │   ├── datasource-tools.ts      # query_data, discover_data, profile_table, etc.
│   │   ├── databricks-tools.ts      # connect/query/discover/profile Databricks via MCP
│   │   ├── auto-improve-tools.ts    # record_reflection, record_feedback, promote_rule, etc.
│   │   ├── agent-tools.ts           # agents_create, spawn_agent, subagents_list, profile configuration
│   │   └── feature-tools.ts         # features_create_skill, features_create_plugin, features_apply
│   ├── features/
│   │   └── runtime.ts               # Live plugin reload + roster reconfiguration for features_apply
│   ├── compute/
│   │   ├── agent-compute.ts         # Per-agent compute profile and private home
│   │   └── docker-env.ts            # ExecutionEnv backed by a per-agent container
│   ├── mcp/                         # MCP transport & auth
│   │   ├── databricks-config.ts     # DATABRICKS_* / ~/.databrickscfg / CLI token resolution
│   │   ├── databricks-oauth.ts      # PKCE browser flow + service-principal client credentials
│   │   └── mcp-sql-client.ts        # streamable HTTP JSON-RPC client, polling, result decoding
│   ├── tasks/                       # Durable state machines (defineTask)
│   │   ├── analysis-workflow.ts     # AnalysisWorkflowTask (Intake -> Profile -> Query -> Audit -> Memo)
│   │   └── auto-improvement.ts     # AutoImprovementTask (Scan -> Distill -> Upgrade Playbook)
│   ├── subagents/                   # Task-owned subagents
│   │   └── auditor-subagent.ts      # Statistical critic subagent
│   ├── observability/               # OpenTelemetry-compatible tracing
│   │   └── langwatch.ts             # LangWatch integration: spans, tokens, and stuck-state guardrails
│   ├── extensions/                  # Extensions & dynamic prompt sections
│   │   └── analyst-extension.ts     # Injects hypotheses, findings, and Playbook into system prompt
│   └── adapters/                    # Data connectors
│       ├── adapter-interface.ts     # DataAdapter interface
│       ├── sqlite-adapter.ts        # Fast SQLite / CSV / JSON query engine
│       └── databricks-adapter.ts    # Read-only Unity Catalog adapter over MCP
├── deploy/                          # Production deployment targets
│   ├── databricks/                  # Databricks Apps: start.sh, deploy.sh
│   └── huggingface/                 # Hugging Face Spaces Terraform & Dockerfile
├── app.yaml                         # Databricks Apps runtime manifest
├── databricks.yml                   # Databricks Asset Bundle (DAB) manifest
├── evals/                           # Offline and real-model evaluation
│   ├── tasks.ts                     # Eval questions, reference SQL, grading
│   ├── trace.ts                     # Transcript -> trace; stuck detector
│   ├── power.ts                     # Statistical power analysis, ICC, and MDE calculation
│   ├── growth-funnel.ts             # 5-stage user funnel attribution, CPSUO, and ARR modeling
│   ├── scripted-agent.ts            # Offline scripted model with injected faults
│   ├── run.ts                       # Runs episodes, writes JSONL + report (bun run evals)
│   ├── report.ts                    # Metrics, variant comparison (bun run evals:report)
│   ├── calibrate.ts                 # Auditor vs human labels, Cohen's kappa (bun run evals:calibrate)
│   ├── stats.ts                     # Bootstrap, Wilson/Newcombe, SRM, Cohen's h and kappa
│   ├── labels/                      # Label format example (placeholder labels)
│   └── results/                     # Committed offline results (synthetic)
├── examples/                        # Executable demonstrations
│   ├── most-impressive-project.ts   # 5-pillar showcase script (bun run showcase)
│   ├── auto-improve-demo.ts         # Live closed-loop self-refinement run
│   ├── crash-resilience-demo.ts     # Crash simulation and seamless resumption
│   ├── databricks-demo.ts           # Databricks-over-MCP discovery, profiling, querying
│   └── demo-run.ts                  # Full analysis pipeline run
├── .pi/mcp.json                     # Registers the Databricks SQL MCP for pi sessions/subagents
├── .env.example                     # Databricks + model provider environment template
├── sample-data/
│   ├── customer_churn.csv           # B2B customer retention dataset
│   ├── cohort_retention.csv         # SaaS cohort retention exhibiting Simpson's Paradox
│   ├── incident_logs.json           # Distributed systems observability logs
│   └── distributed_traces.jsonl     # High-throughput microservice traces in NDJSON
└── tests/                           # Unit & integration test suite (309 tests, 0 failures)
    ├── docs.test.ts                 # Tests for durable documents
    ├── report-generator.test.ts     # Markdown, HTML, and JSON executive memo generators
    ├── sqlite-adapter.test.ts       # Tests for data profiling & query engine (CSV/TSV/JSON/NDJSON)
    ├── databricks-mcp.test.ts       # MCP client, SQL safety, OAuth helpers, and adapter tests
    ├── databricks-oauth-flow.test.ts # End-to-end browser OAuth callback + MCP connect (mock workspace)
    ├── workflow.test.ts             # Tests for AnalysisWorkflowTask
    ├── auto-improvement.test.ts     # Tests for AutoImprovementTask
    ├── agents.test.ts               # Roster rules and the chat create → delegate → archive loop
    ├── main-agent.test.ts           # The root conversation is the analyst; workspace snapshot
    ├── tool-output.test.ts          # Tool results reach the model; audit verdict parsing
    ├── workspace-context.test.ts    # Skills, bootstrap files, prompt assembly
    ├── chat-ui.test.ts              # Transcript grouping and tool summaries
    ├── pi-config.test.ts            # Model provider / settings resolution
    ├── plugins.test.ts              # Manifest discovery, MCP + script transports, capability resolution
    ├── plugin-agent-tools.test.ts   # <plugin>__<tool> agent tools, deferred, errors, harness wiring
    ├── capabilities.test.ts         # Enable/disable config, add/remove plugins and skills
    └── evals.test.ts                # Stats, grading, stuck detector, calibration, offline episodes
```
