# Pre-registration: [Experiment Name]

*Pre-registered before launch. Any changes after launch must be recorded under Deviations.*

---

## 1. Experiment Overview & Objective

| Item | Value |
|---|---|
| **Plan ID** | *from design()* |
| **Hypothesis** | *[Proposed change] will [improve/preserve] [OEC] because [causal mechanism]* |
| **Trial Type** | *Superiority / Non-Inferiority / Equivalence* |
| **Non-Inferiority Margin ($\Delta_{NI}$)** | *If Non-Inferiority: max acceptable degradation (e.g. drop $\le 0.5\%$), and business justification (cost savings, tech debt reduction, latency win)* |
| **Overall Evaluation Criterion (OEC)** | *Single primary metric aligning short-term action with long-term lifetime value* |
| **OEC Metric Type & Spec** | *mean, proportion, ratio (numer/denom), quantile (q=0.9), or bootstrap (statistic)* |
| **OEC Ungameability Check** | *Explain why this metric cannot be artificially gamed by a degraded user experience* |

---

## 2. Guardrails (Health & Safety Constraints)

*Guardrails must not be breached. Define automated hard stops and trade-off thresholds.*

| Guardrail Metric | Category | Baseline Value | Acceptable Harm Limit | Hard Stop Action |
|---|---|---|---|---|
| **Latency (p95 / p99)** | System Health | *e.g., 220ms / 480ms* | *e.g., Increase $\le 15\text{ms}$* | *Auto-abort if p95 $> +50\text{ms}$* |
| **5xx / Crash Rate** | System Health | *e.g., 0.02%* | *e.g., Increase $\le 0.05\%$* | *Auto-abort if error rate $> 0.2\%$* |
| **Client JS Exceptions** | System Health | *e.g., 0.1%* | *e.g., Increase $\le 0.05\%$* | *Auto-abort if crash spike detected* |
| **Unsubscribe / Churn Rate** | Business / Trust | *e.g., 1.2%* | *e.g., Increase $\le 0.1\%$* | *Rollback if CI exceeds limit* |
| **Support Contact Rate** | Business / Trust | *e.g., 0.4%* | *e.g., Increase $\le 0.05\%$* | *Review before launch* |

---

## 3. Secondary & Diagnostic Metrics (Mechanisms & Cannibalization)

*Explains how the change works and checks for unintended side effects. Not standalone launch criteria.*

| Metric | Category | Role | Multiple Testing Correction |
|---|---|---|---|
| *[e.g., Funnel Step 2 Completion]* | Diagnostic | *Validates causal mechanism on checkout path* | *Holm / Benjamini-Hochberg* |
| *[e.g., Search Refinement Rate]* | Diagnostic | *Checks user friction / confusion* | *Holm / Benjamini-Hochberg* |
| *[e.g., Category B Purchase Rate]* | Cannibalization | *Checks if lift cannibalized adjacent product sales* | *Holm / Benjamini-Hochberg* |

---

## 4. Population, Triggering & Randomization

| Item | Value |
|---|---|
| **Randomization Unit** | *user, account, workspace, or device* |
| **Analysis Unit** | *session, message, order, or same as randomization unit* |
| **Declared `randomization_unit`** | *Set whenever analysis unit is finer than randomization unit (delta method / clustering)* |
| **Triggering Condition** | *Exact condition when a user enters the experiment (untriggered users excluded to avoid dilution)* |
| **Target Population / Filters** | *Geography, platform, new vs returning, eligibility rules* |

---

## 5. Statistical Parameters & Sizing

| Item | Value |
|---|---|
| **Alpha ($\alpha$)** | *0.05 (two-sided for superiority) or 0.025 / 0.05 (one-sided for non-inferiority)* |
| **MDE (Relative)** | *Smallest relative lift worth shipping (for superiority)* |
| **Statistical Power ($1 - \beta$)** | *0.80 or 0.90* |
| **Sample Size per Arm** | *from power() output* |
| **Total Sample Size** | *from power() output* |
| **Power Assumptions** | *Baseline mean, std, ratio, cuped_r2 copied from power() tool* |
| **Start Date** | *YYYY-MM-DD* |
| **Planned Stop Date** | *Must span at least 7 or 14 full days to cover weekly cycles* |
| **Minimum Duration** | *Minimum 7 or 14 full days (enforces full day-of-week coverage)* |
| **Sequential Testing (mSPRT)** | *No (fixed horizon) or Yes (pre-registered $\tau^2$ or MDE, `max_n_per_arm`, look schedule)* |

---

## 6. Analysis Plan & Methodology

| Item | Value |
|---|---|
| **Statistical Method** | *t-test, delta method (ratio metrics), CUPED, Yuen's trimmed t-test, bootstrap quantile* |
| **CUPED Covariates** | *Pre-experiment covariates measured strictly prior to treatment exposure* |
| **Heavy Tail Strategy** | *Winsorization percentile, trimmed mean, or quantile bootstrap (if pre-planned)* |
| **Multiple Testing Plan** | *None (single primary OEC), Holm (co-primary/secondary), or BH (exploratory)* |
| **Segments** | *None, exploratory (Holm adjusted), or pre-registered confirmatory segment* |
| **Interim Checks Allowed** | *SRM check ($\alpha = 0.001$), automated system health guardrails* |

---

## 7. Deviations Log

*Any post-launch modification to sample size, metrics, dates, or stopping conditions.*

| Date | What Changed | Sample Reached | Rationale | Approved By |
|---|---|---|---|---|
