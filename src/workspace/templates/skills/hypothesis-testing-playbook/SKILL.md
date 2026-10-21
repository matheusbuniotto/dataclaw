---
name: hypothesis-testing-playbook
description: Runs A/B tests, non-inferiority/superiority trials, and agent-eval comparisons the honest way, incorporating Ron Kohavi's experimentation best practices (Overall Evaluation Criterion / OEC, system and business guardrails, secondary diagnostic and cannibalization metrics, Twyman's Law, non-inferiority margins, sample ratio mismatch, triggering, and weekly seasonality cycles) using hypothesis-testing MCP tools (design, power, srm_check, analyze, sequential_check, compare_eval_runs, report). Pre-registers the trial type, sizes the sample, guards against early peeking unless sequential mSPRT was planned, blocks on SRM, uses correct variance and clustering methods (delta method, CUPED, Yuen, bootstrap), and delivers traceable reports. Use when the user plans, sizes, monitors, analyzes, or reports an A/B test, feature rollout, architecture migration, or agent eval.
license: MIT
compatibility: Expects an MCP server exposing design, power, analyze, srm_check, sequential_check, compare_eval_runs, and report (see references/tool-contract.md). Without it the skill still guides the process and enforces statistical discipline.
metadata:
  author: Matheus Buniotto
  version: "0.3.0"
---
# Hypothesis testing playbook (Controlled Experiments & Best Practices)

A test is only as good as the plan written before the data arrived.
Your job is to keep the user honest with that plan and ensure decision trustworthiness—not to hunt for a significant result or rubber-stamp a launch.

This playbook synthesizes controlled experimentation discipline and **Ron Kohavi's best practices** (*Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing*):
- Distinguishing **Superiority** vs **Non-Inferiority** trials with explicit margins
- Formulating an **Overall Evaluation Criterion (OEC)** while preventing metric gaming
- Enforcing **System Health & Business Guardrails** with strict harm thresholds
- Tracking **Secondary Diagnostic & Cannibalization Metrics** with multiple testing adjustments
- Heeding **Twyman's Law**: "Any figure that looks interesting or different is usually wrong"
- Checking **Sample Ratio Mismatch (SRM)** first before any metric interpretation
- Preventing effect dilution through rigorous **Triggering**
- Enforcing **Minimum 1-2 Full Week Durations** to capture weekly seasonality and avoid primacy/novelty bias

---

## Rules that apply at every step

1. **No invented numbers.** Every statistic you write (effect, CI, p-value, sample size, power, SRM p-value, std, seed, n_resamples, non-inferiority margin) is copied from a tool output in this session or quoted directly from the user's pre-registration. Never derive numbers in prose (no "about a 5% lift", "around 12 cases"). Write "0.70 vs 0.77" and let a tool produce the delta and confidence interval. If a tool is unavailable, state `not computed: <tool> unavailable` and stop there for that figure.
2. **The pre-registered plan wins.** Trial type (superiority vs non-inferiority), primary OEC, guardrail harm boundaries, secondary metrics, method, randomization unit, CUPED covariates, segments, and stopping rules come from pre-registration. A change after seeing data is a deviation: allowed only if explicitly labeled as a deviation with the pre-registered analysis reported first.
3. **Twyman's Law applies to extreme wins.** If Treatment shows a massive lift (e.g. >3x the planned MDE or double-digit gains in key metrics), assume data instrumentation bugs, bot skew, tracking drops, or outlier contamination before declaring victory. Audit the telemetry before reporting.
4. **Effect size with Confidence Interval, always.** Never report a p-value alone. "Not statistically significant" means the CI includes zero (or includes the non-inferiority boundary), NOT that there is "no effect".
5. **Enforce full weekly cycles (minimum 1–2 weeks).** Even if target sample size or sequential boundaries are reached in 2 days, do not conclude early unless aborting for catastrophic guardrail failure. Weekend and weekday user behavior differs systematically.
6. **The decision belongs to the user.** You present what the data statistically support. If stakeholders decide against the evidence, help them document it as a transparent business risk.
7. **One question at a time** when you need user clarification; otherwise keep progressing through the steps.

---

## Route the request

| Situation | Start at |
|---|---|
| New experiment or feature rollout, nothing launched yet | **Step 1** |
| Running experiment, user wants an early read or progress check | **Step 3** |
| Finished experiment, user wants results, interpretation, or report | **Step 4** |
| Comparing two agent, prompt, or model versions on an eval set | **Step 7** |

If a pre-registration already exists (`plan_id`, `PREREGISTRATION.md`, or pasted plan), read it first before taking any action.

---

## Step 1. Pre-register (OEC, Guardrails, Secondary Metrics & Trial Type)

Complete the plan with the user using `assets/PREREGISTRATION_TEMPLATE.md`:

### 1.1 Trial Type & Objective
- **Superiority Trial**: The default. Objective is to prove Treatment is better than Control on the primary OEC ($H_0: \Delta \le 0 \text{ vs } H_1: \Delta > 0$). Requires the CI lower bound to clear 0 (or positive MDE).
- **Non-Inferiority Trial**: Used when Treatment offers secondary advantages (infrastructure cost reduction, tech stack migration, latency reduction, refactoring, code simplification, privacy compliance) and the goal is to prove Treatment is *not unacceptably worse* on core business metrics. Pre-register:
  - Non-inferiority margin $\Delta_{NI} > 0$ (the maximum acceptable degradation, e.g. "conversion drop $\le 0.5\%$").
  - $H_0: \mu_T - \mu_C \le -\Delta_{NI} \text{ vs } H_1: \mu_T - \mu_C > -\Delta_{NI}$.
  - Justification for the chosen $\Delta_{NI}$ based on business tolerance and cost savings.
- **Equivalence Trial**: Proving Treatment is within $[-\Delta, +\Delta]$ of Control.

### 1.2 Overall Evaluation Criterion (OEC) / Primary Metric
- Exactly one primary metric.
- Must be a measurable short-term proxy that reliably aligns with long-term customer lifetime value (Kohavi OEC).
- Check for **ungameability**: Ensure the metric cannot be artificially inflated by bad user experiences (e.g., more queries per session because search results are irrelevant; more page views because navigation is broken).
- Metric type: `mean`, `proportion`, `ratio` (numerator and denominator), `quantile` (with $q$, e.g. p90 latency), or `bootstrap` (with statistic).

### 1.3 Guardrails (System Health & Business Viability)
Guardrails protect the system and user trust. Pre-register explicit thresholds:
- **System Health Guardrails**: Latency (p95/p99), 5xx server error rate, client-side crash/exception rate, timeout rate.
- **Business & User Experience Guardrails**: Unsubscribe rate, account cancellation/churn rate, refund requests, support contact rate, page load time.
- **Action Thresholds**:
  - *Hard Stop*: Automated abort if guardrail harm exceeds catastrophic boundary during monitoring (e.g., error rate $> +0.2\%$ or p95 latency $> +50\text{ms}$).
  - *Trade-off Limit*: Maximum acceptable degradation tolerated if the primary OEC shows a strong win.

### 1.4 Secondary & Diagnostic Metrics (Mechanism & Cannibalization)
- **Diagnostic Metrics**: Funnel stages, click-through rates, feature engagement that explain *why* the OEC moved.
- **Cannibalization Metrics**: Adjacent product views/purchases, organic search clicks (vs promoted module clicks).
- **Multiple Testing Correction**: Holm or Benjamini-Hochberg (BH) for the secondary metric family.

### 1.5 Unit of Randomization & Triggering
- **Randomization Unit**: User, account, workspace, or device.
- **Analysis Unit**: Session, message, query, or order. If analysis unit is finer than randomization unit, declare `randomization_unit` for clustering / delta method.
- **Triggering Definition**: Define the exact trigger condition (only include units that reached the altered experience). Exclude untriggered units to avoid effect dilution.

### 1.6 Design & Horizon
- Alpha (default 0.05 two-sided for superiority; 0.025 or 0.05 one-sided for non-inferiority).
- MDE (relative minimum detectable effect) or non-inferiority margin $\Delta_{NI}$.
- Sequential testing: No (fixed horizon) or Yes (mSPRT with pre-registered $\tau^2$ or MDE, `max_n_per_arm`, look schedule).
- Minimum duration: Pre-commit to at least 7 or 14 full days (1–2 weekly cycles).

Call `design(...)` with these parameters.

**Done when:** `plan_id` and `preregistration_md` are populated with no empty items and confirmed by the user.

---

## Step 2. Size the sample (Power & Non-Inferiority Sizing)

Call `power(...)` with historical baseline mean (and std for continuous metrics):
- Pass `cuped_r2` only if CUPED was pre-registered with a historical pre-experiment correlation estimate.
- For **Superiority**: Size for 80% or 90% power to detect the business MDE.
- For **Non-Inferiority**: Size specifically to reject $H_0: \mu_T - \mu_C \le -\Delta_{NI}$ under the assumption that true effect is 0 (or expected small delta). Non-inferiority tests with tight margins often require substantially larger sample sizes than superiority tests!
- Validate feasibility: If required `n_per_arm` cannot be reached within a reasonable timeframe (e.g. 2–4 weeks), adjust the design pre-launch: employ CUPED variance reduction, choose a more sensitive OEC, trigger more strictly, or widen $\Delta_{NI}$ if business justifies. Never launch planning to "peek and see".

**Done when:** `n_per_arm`, `total_n`, and the planned calendar stop date are recorded in the plan alongside tool `assumptions`.

---

## Step 3. Wait for full sample and weekly duration (Unless Sequential)

### Fixed-Horizon Experiment (Default)
- **Do not peek at the primary OEC.** Checking p-values repeatedly inflates false positive rates far above alpha (e.g., peeking 5 times turns a nominal 5% alpha into ~15–20% false positive risk).
- **Respect weekly seasonality:** Even if sample size is reached on day 3, run for at least 7 or 14 full days to cover weekday/weekend variations and allow novelty effects to cool down.
- **Allowed interim checks:**
  1. `srm_check` on assignment counts.
  2. System health guardrails (hard stop checks for severe latency spikes or error rates).
  3. Telemetry and logging verification (both variants logging events properly).

### Sequential Experiment (mSPRT)
- Only valid if pre-registered as "sequential: yes" before launch with fixed look schedule.
- Call `sequential_check(looks, metric_type, alpha, tau2 or mde, max_n_per_arm)` at scheduled intervals.
- `decision` values:
  - `continue`: No conclusion. Do not claim "trending" or "almost significant". Keep collecting.
  - `stop_reject`: Always-valid CI excludes 0 (or clears non-inferiority boundary). Proceed to Step 4.
  - `stop_max_n`: Maximum planned sample reached without rejection. Conclude inconclusive.
- If guardrail hard stop triggers: Abort immediately as a safety failure.

### Handling Early Shipping Pressure
If stakeholders demand stopping a fixed-horizon test early because it "looks like a win":
1. State clearly that interim p-values are invalid and not evidence of a true effect.
2. Provide the options:
   - (a) Complete the planned duration and sample size.
   - (b) Ship as an unmeasured business decision (documented deviation, no statistical claim).
   - (c) Pre-register future tests as sequential mSPRT if speed to ship is paramount.
3. Record any deviation openly in the pre-registration log.

**Done when:** Planned sample size AND minimum duration (full weekly cycles) are satisfied; or a pre-registered sequential test triggers stopping; or an emergency guardrail stop occurs.

---

## Step 4. Check the split first (Sample Ratio Mismatch / SRM)

Call `srm_check(counts, expected_ratio)` with $\alpha = 0.001$ before inspecting any effects.
- Count **randomization units** (unique users or accounts), not raw events or page views.
- If `is_srm` is **true**: **STOP immediately.**
  - **Do not interpret or report any metric lifts.** An SRM indicates that the sample is biased or that users in one arm were systematically lost, corrupted, or filtered. Any observed lift may simply reflect who went missing.
  - Investigate root causes (see `references/interpretation-pitfalls.md`):
    - Redirection latency or client-side flickers causing bounce before logging
    - Platform-specific crashes or JS exceptions in Treatment
    - Bot or fraud detection filtering arms unevenly
    - Leaky bucketing or user ID assignment timing
    - Triggering applied inconsistently across variants
- Report the SRM diagnostic and investigation list. Do not proceed until the root cause is resolved or the experiment is re-run.

**Done when:** `is_srm` is false, or an SRM diagnostic report is delivered.

---

## Step 5. Analyze as planned

Call `analyze(...)` strictly adhering to pre-registered settings:
- **Randomization Unit & Clustering:** Declare `randomization_unit` whenever observations (sessions, messages, transactions) cluster under randomized units (users, accounts). Prevents falsely narrow CIs.
- **Ratio Metrics:** Ensure delta method is used for ratio metrics (e.g., revenue per order, clicks per session).
- **CUPED:** Ensure pre-experiment covariates are applied as planned. Covariates must be measured strictly before treatment exposure.
- **Heavy Tails:** Use pre-registered winsorizing + Yuen's trimmed t-test, or bootstrap quantile metrics for revenue, order value, or latency.
- **Guardrails:** Compute effect and CI for all system and business guardrail metrics.
- **Secondary Metrics:** Apply Holm or BH multiple-testing correction across the secondary metric family.
- **Segments:** Slices are exploratory by default. Report Holm-adjusted values and state exploratory disclaimer. Never ship based on a post-hoc segment win when the overall test is neutral.

**Done when:** All pre-registered metrics have outputs containing point estimates, CIs, adjusted p-values / significance flags, and verified methods.

---

## Step 6. Interpret and report (Decision Matrix & Kohavi Best Practices)

Evaluate the overall results using the decision framework:

### 6.1 Twyman's Law Audit
Before celebrating any positive result:
- Check if the lift is implausibly large ($>3\times$ pre-registered MDE or $>20\%$ on core mature metrics).
- Check if the lift is driven by a single extreme outlier or whale.
- Check if engagement metrics spiked due to confusion or error loops.
- If suspicious, audit data integrity before presenting as a win.

### 6.2 Superiority Trial Decision Matrix

| Primary OEC Result | Guardrail Metrics | Secondary / Cannibalization | Verdict & Action |
|---|---|---|---|
| CI excludes 0 in planned direction | All guardrails healthy within acceptable limits | No cannibalization, mechanisms confirmed | **Statistically Significant Win.** Evidence supports launch. |
| CI excludes 0 in planned direction | One or more guardrails breached past acceptable harm | Neutral or mixed | **Win with Trade-off Cost.** Quantify the tradeoff (e.g., $+2\%$ revenue but $+40\text{ms}$ p95 latency); business stakeholders decide. |
| CI includes 0 | All guardrails healthy | Neutral | **Inconclusive.** Plausible effects range from CI lower to upper bound. Not "no effect". Do not ship. |
| CI includes 0 | Guardrail hard stop breached | Negative | **Failed Experiment.** Do not ship. |
| CI excludes 0 in harmful direction | Any | Any | **Statistically Significant Harm.** Roll back / do not ship. |

### 6.3 Non-Inferiority Trial Decision Matrix (Margin $\Delta_{NI} > 0$)

| Primary Metric CI for $(\mu_T - \mu_C)$ | Guardrail Metrics | Secondary Advantage (Cost, Speed, Refactor) | Verdict & Action |
|---|---|---|---|
| Lower bound $> 0$ | Healthy | Confirmed | **Superior and Non-Inferior.** Clear launch recommendation. |
| Lower bound $> -\Delta_{NI}$ and Upper bound $\ge 0$ | Healthy | Confirmed | **Non-Inferiority Established.** Core business metrics preserved within margin while unlocking secondary advantages. Safe to ship. |
| Lower bound $\le -\Delta_{NI}$ and Upper bound $> 0$ | Healthy | Confirmed | **Inconclusive on Non-Inferiority.** Cannot rule out degradation exceeding the acceptable margin. Do not ship without larger sample or risk sign-off. |
| Upper bound $< -\Delta_{NI}$ | Any | Any | **Inferiority Proven.** Degradation definitively exceeds acceptable margin. Reject rollout. |

### 6.4 Reporting
Call `report(plan_id, results, srm, sequential, audience)`:
- For stakeholders: Use `assets/REPORT_TEMPLATE.md` (plain language, plausible ranges instead of p-values, explicit guardrail status, next action).
- For technical teams: Detailed breakdown of OEC, secondary metrics with multiple-testing adjustments, guardrail p95/p99 latency, SRM details, and deviation logs.

**Done when:** A complete, traceable report with decision verdict, guardrail audit, and next steps is generated.

---

## Step 7. Compare two agent versions on an eval set

When comparing stochastic agents, prompts, or model configurations:
1. **Never judge from a single run per version.** Run-to-run variance can exceed the true model difference.
2. Require at least **5 runs per version on the identical set of cases** (paired design).
3. Call `compare_eval_runs(scores_a, scores_b, paired=True)`.
4. Use `ci_method="cluster_bootstrap"` when cases are under 50, scores are discrete/bounded (pass/fail, 1–5 scale), or runs share cache, temperature seeds, or tool state.
5. Report `diff`, `ci`, p-value, `run_to_run_std_a`, `run_to_run_std_b`, `n_cases`, `n_runs`, `seed`, and `n_resamples`.
6. Apply the decision matrix from Step 6: A CI containing 0 is inconclusive, not equal performance.
7. Disclose eval set limitations (sample size, whether cases were used for prompt tuning, alignment with production traffic).

**Done when:** Summary report with diff, confidence interval, run-to-run stability, bootstrap parameters, and verified verdict is produced.

---

## Files in this skill

- `assets/PREREGISTRATION_TEMPLATE.md`: Comprehensive template covering trial type (superiority/non-inferiority), OEC, guardrails, secondary metrics, triggering, and duration.
- `assets/REPORT_TEMPLATE.md`: Stakeholder and technical report formats including guardrail audits and non-inferiority reporting.
- `references/interpretation-pitfalls.md`: In-depth guide on Ron Kohavi's principles, Twyman's Law, non-inferiority margins, guardrail architectures, cannibalization, triggering dilution, and SRM diagnostics.
- `references/tool-contract.md`: Exact input/output schemas for the hypothesis testing MCP tools.
