# Experiment Report Templates

*Every number in this report must be traced back to tool output or pre-registration. No invented or approximated statistics.*

---

## 1. Stakeholder Executive Report

### Decision Headline
**[One clear sentence: what the evidence supports, the launch decision, or why the test remains inconclusive.]**

- **Experiment:** *[Experiment Name], [Trial Type: Superiority / Non-Inferiority], [Dates: spanning X full weekly cycles], [N per arm reached vs planned].*
- **Primary Result (OEC):**
  - *Superiority:* *[OEC Name] changed by [rel_effect] (plausible range: [rel_ci low] to [rel_ci high], [adjusted p-value or significance]).*
  - *Non-Inferiority:* *[OEC Name] change is [rel_effect] (plausible range: [rel_ci low] to [rel_ci high]). Lower bound clears the non-inferiority threshold of -[margin], confirming non-inferiority while securing [secondary advantage, e.g., $X/mo infrastructure savings].*
  - *Inconclusive:* *The data are compatible with effects ranging from [rel_ci low] to [rel_ci high]. No statistically significant difference detected.*
  - *Sequential In-Progress:* *Test actively running; pre-registered sequential mSPRT indicates continue.*
  - *Blocked by SRM:* *Reporting blocked due to Sample Ratio Mismatch (SRM). Data integrity must be investigated before interpreting lifts.*
- **Guardrails Audit:**
  - *System Health:* *Latency p95: [effect and range], 5xx Error Rate: [effect and range] — all within acceptable safety boundaries.*
  - *Business Trust:* *Unsubscribes/churn: [effect and range] — no harmful regression detected.*
- **Secondary & Diagnostic Metrics:**
  - *Mechanism:* *[e.g., Checkout step 2 conversion increased by +X%, confirming the intended mechanism].*
  - *Cannibalization:* *[e.g., Adjacent product engagement remained steady at [range], indicating net-positive lift].*
- **Twyman's Law Sanity Check:** *Lift validated against baseline historical volatility; no tracking dropouts, bot anomalies, or extreme outliers detected.*
- **Caveats & Seasonality:** *Verified full weekly seasonality ([X] full weeks). [Any documented deviations or technical warnings].*
- **Recommended Action:** *[Ship / Do Not Ship / Continue Collecting / Rollback], [Owner], [Target Date].*

---

## 2. Technical Statistical Report

### 2.1 Metadata & Experimental Design
- **Plan ID:** `[plan_id]`
- **Trial Type:** `[Superiority | Non-Inferiority | Equivalence]`
- **Non-Inferiority Margin ($\Delta_{NI}$):** `[margin]` *(if applicable)*
- **Primary OEC:** `[metric name]` (`[type: mean/proportion/ratio/quantile/bootstrap]`)
- **Randomization Unit / Analysis Unit:** `[randomization_unit]` / `[analysis_unit]`
- **Sample Size per Arm:** `[planned_n]` planned vs `[observed_n]` observed
- **Duration:** `[start_date]` to `[end_date]` (`[days]` days — `[full weeks]` full 7-day cycles)

### 2.2 Data Integrity & SRM Check
- **SRM Check ($\alpha = 0.001$):**
  - Control observed: `[observed_control]`, Treatment observed: `[observed_treatment]`
  - Expected ratio: `[expected_ratio]`
  - SRM Chi-Square / p-value: `[srm_pvalue]`, `is_srm: [false | true]`
  - *If `is_srm: true`, halt interpretation and attach diagnostic investigation.*

### 2.3 Primary OEC Results

| Metric | Randomization Unit | Control Mean | Treatment Mean | Absolute Effect (95% CI) | Relative Effect (95% CI) | p-value (raw / adj) | Method | Verdict |
|---|---|---|---|---|---|---|---|---|
| *[OEC]* | *[unit]* | *[ctrl]* | *[trt]* | *[abs] ([ci_low], [ci_high])* | *[rel] ([ci_low], [ci_high])* | *[pval]* | *[delta/CUPED/Yuen]* | *[Superior / Non-Inferior / Inconclusive]* |

*If Non-Inferiority:*
- Lower bound of 95% CI: `[ci_low]` vs Non-Inferiority Margin: `[-margin]`.
- Decision: `[Lower bound > -margin -> Non-Inferiority Established | Lower bound <= -margin -> Inconclusive / Failed]`.

### 2.4 Guardrail Metrics Table

| Guardrail Metric | Category | Control | Treatment | Effect (95% CI) | Acceptable Limit | Status |
|---|---|---|---|---|---|---|
| Latency p95 | System Health | `[ctrl]` | `[trt]` | `[effect] ([low], [high])` | `[limit]` | `[PASS / BREACH]` |
| Latency p99 | System Health | `[ctrl]` | `[trt]` | `[effect] ([low], [high])` | `[limit]` | `[PASS / BREACH]` |
| Error Rate (5xx) | System Health | `[ctrl]` | `[trt]` | `[effect] ([low], [high])` | `[limit]` | `[PASS / BREACH]` |
| Churn / Unsubscribes | Business | `[ctrl]` | `[trt]` | `[effect] ([low], [high])` | `[limit]` | `[PASS / BREACH]` |

### 2.5 Secondary & Diagnostic Metrics Table

| Secondary Metric | Category | Absolute Effect | Relative Effect (95% CI) | Raw p-value | Adjusted p-value (Holm/BH) | Significant |
|---|---|---|---|---|---|---|
| *[Metric 1]* | Diagnostic | `[abs]` | `[rel] ([low], [high])` | `[raw_p]` | `[adj_p]` | `[Yes/No]` |
| *[Metric 2]* | Cannibalization | `[abs]` | `[rel] ([low], [high])` | `[raw_p]` | `[adj_p]` | `[Yes/No]` |

*Subgroup / Segment Analysis (labeled Exploratory):*
- *[Segment results with Holm adjustment, flagged as exploratory hypotheses for future testing]*

### 2.6 Deviations & Sensitivity Analyses
- *[List any deviations from pre-registration, e.g., unadjusted sample size adjustments, covariate adjustments, outlier clipping]*

---

## 3. Agent Eval Comparison Report (Stochastic Systems)

- **Models / Prompts Evaluated:** Version A (`[name_a]`) vs Version B (`[name_b]`)
- **Cases Evaluated:** `[n_cases]` paired benchmark cases
- **Runs Completed:** `[n_runs]` repeated runs per version
- **Mean Scores:** Version A: `[mean_a]` (run-to-run std: `[std_a]`), Version B: `[mean_b]` (run-to-run std: `[std_b]`)
- **Difference:** `[diff]`, 95% Confidence Interval: `[ci_low]` to `[ci_high]`
- **Inference Method:** `[cluster_bootstrap | analytic]`, `seed: [seed]`, `n_resamples: [n_resamples]`
- **Bootstrap p-value:** `[pvalue]` *(if at floor: "p ≤ 1/(N+1)")*
- **Verdict:** `[Version B Statistically Superior | Inconclusive | Version A Superior]`
- **Caveats:** *[Evaluation benchmark representative of production, leakage verification, temperature/seed configuration]*
