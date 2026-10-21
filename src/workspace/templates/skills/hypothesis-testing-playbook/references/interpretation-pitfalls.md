# Interpretation Pitfalls & Controlled Experimentation Best Practices

Comprehensive guidance based on **Ron Kohavi's experimentation principles** (*Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing*).

Each section outlines the pitfall, the statistical/business risk, how to prevent or resolve it, and exact phrasing to use.

---

## 1. Twyman's Law: "Any figure that looks interesting or different is usually wrong"

### The Pitfall
A team runs an experiment and observes an extraordinary result: conversion jumped by +28%, or click-through on a new component doubled. The team immediately celebrates, writes an executive summary, and plans immediate 100% rollout.

### Why It Goes Wrong
Extreme positive or negative results are almost always caused by:
1. **Instrumentation or logging bugs:** Treatment events logged twice; control events dropped; telemetry endpoint failing under certain conditions.
2. **Bot or crawler traffic:** Treatment URL or component triggered an automated indexing crawler, skewing visit counts and engagement.
3. **Outlier / whale distortion:** A single enterprise account or bulk buyer made a $50,000 purchase in Treatment, completely skewing the mean.
4. **Triggering or eligibility leakage:** Users in Treatment were filtered differently than Control, creating a hidden Sample Ratio Mismatch.

### How to Guard
- Before accepting any result that is $>3\times$ the planned MDE or double-digit on a mature business metric:
  - Audit raw logs and event counts per arm.
  - Check user-level distributions: remove the top 0.1% of users and re-calculate. Does the effect evaporate?
  - Verify bot filters and user-agent classifications.
  - Validate that downstream conversion stages also show consistent, plausible lifts.
- **Say:** *"Treatment shows an unusually large lift of [lift]%. Under Twyman's Law, extreme figures warrant data integrity verification before celebrating. We are auditing logging telemetry, outlier impact, and bot filtering."*

---

## 2. Non-Inferiority vs Superiority Trials

### The Distinction
- **Superiority Trial:** Objective is to prove Treatment is *statistically significantly better* than Control on the primary OEC ($H_0: \Delta \le 0 \text{ vs } H_1: \Delta > 0$).
- **Non-Inferiority Trial:** Objective is to prove Treatment is *not unacceptably worse* than Control by more than a pre-specified margin $\Delta_{NI} > 0$ ($H_0: \mu_T - \mu_C \le -\Delta_{NI} \text{ vs } H_1: \mu_T - \mu_C > -\Delta_{NI}$).
  - Typically used for infrastructure migrations, tech debt refactoring, vendor swaps, latency optimizations, cost reductions, or redesigns where the secondary benefit is already guaranteed.

### Pitfalls in Non-Inferiority
1. **Picking the margin after seeing data:** Choosing $\Delta_{NI}$ post-hoc to match whatever CI lower bound was observed is severe p-hacking. $\Delta_{NI}$ MUST be pre-registered.
2. **Confusing non-inferiority with "no difference":** Failing to reject a standard superiority null hypothesis does NOT establish non-inferiority. You must reject $H_0: \mu_T - \mu_C \le -\Delta_{NI}$ (i.e. the lower bound of the CI must strictly exceed $-\Delta_{NI}$).
3. **Sample size under-sizing:** Non-inferiority tests with tight margins ($\Delta_{NI} < \text{MDE}$) often require $2\times$ to $4\times$ more sample size than a standard superiority test.
4. **Claiming superiority without evidence:** If a non-inferiority test demonstrates non-inferiority, you may claim superiority *only* if the CI lower bound also clears 0.

### How to Pre-register $\Delta_{NI}$
- Base $\Delta_{NI}$ on business trade-offs: e.g., *"The new infrastructure saves $40,000/month in compute. We can tolerate up to a 0.5% drop in checkout conversion ($\Delta_{NI} = 0.5\%$), which represents at most $15,000/month in revenue risk."*
- **Say (Non-Inferior):** *"Non-inferiority established: The estimated difference is [diff] (95% CI: [low] to [high]). The lower bound of [low] clears the pre-registered non-inferiority margin of -[margin], confirming the change does not harm core metrics beyond our risk tolerance."*
- **Say (Inconclusive):** *"Inconclusive on non-inferiority: The CI extends to [low], which breaches our acceptable margin of -[margin]. We cannot rule out unacceptable degradation."*

---

## 3. Overall Evaluation Criterion (OEC) & Ungameability

### The Pitfall
Choosing a primary metric that is short-sighted, misaligned with customer satisfaction, or susceptible to **Goodhart's Law** ("When a measure becomes a target, it ceases to be a good measure").

### Examples of Gamed Metrics
- **Number of queries per search session:** An algorithm that returns poor, irrelevant results forces users to re-query multiple times, making the metric spike while users are frustrated.
- **Click-through rate (CTR) on email:** Misleading clickbait subjects increase clicks but double unsubscribe and spam report rates.
- **Page views:** Breaking an article into 10 paginated slides increases page views $10\times$ while cratering user retention.

### How to Design an OEC
- Formulate a metric that balances short-term user behavior with long-term lifetime value (e.g., successful task completion, 30-day repeat usage, revenue net of refunds/returns).
- Couple the OEC with strict **Guardrails** that capture user friction and trust.

---

## 4. Guardrail Metrics (System Health & Business Viability)

### The Architecture
Every experiment must monitor two tiers of guardrails:
1. **System Health Guardrails:**
   - Latency percentiles: Always monitor **p95 and p99 latency**, never mean latency alone. A treatment that adds 150ms to the 99th percentile will destroy high-value power user experiences while barely budging mean latency.
   - 5xx HTTP error rates, unhandled client JavaScript exceptions, crash rates, network timeouts.
2. **Business & Trust Guardrails:**
   - Churn, unsubscribe rates, account cancellations, refund requests, support ticket creation rate.

### Automated Hard Stops vs Trade-off Limits
- **Hard Stop:** If a system health guardrail breaches the catastrophic threshold (e.g., error rate $> 0.2\%$ or p95 latency $> +50\text{ms}$), the experiment must be automatically aborted immediately.
- **Trade-off:** If the primary OEC shows a strong win but a secondary guardrail is mildly degraded (e.g., $+2\%$ revenue but $+10\text{ms}$ latency), the result is categorized as *"Win with Trade-off Cost"*, and human stakeholders must consciously weigh the trade-off.

---

## 5. Secondary Metrics, Mechanism Validation & Cannibalization

### The Role of Secondary Metrics
Secondary metrics serve two essential purposes:
1. **Diagnostic / Mechanism Validation:** Explain *how* the change produced the OEC lift (e.g., if checkout conversion rose, did add-to-cart increase, or did payment form drop-off decrease?).
2. **Cannibalization Detection:** Detect if gains in Treatment cannibalized adjacent products, features, or channels (e.g., clicks on a new recommendation carousel siphoned clicks from organic navigation).

### Pitfalls
- **Hunting for significance in secondary metrics:** Examining 30 secondary metrics without adjustment guarantees at least one will be significant by pure chance ($1 - 0.95^{30} \approx 78.5\%$ chance of false positive).
- **Shipping on a secondary win:** If the primary OEC failed to show lift, shipping because a secondary metric moved is p-hacking.
- **Remedy:** Apply Holm or Benjamini-Hochberg (BH) False Discovery Rate correction across the pre-registered secondary metric family. Treat secondary metrics as explanatory diagnostics, not primary ship criteria.

---

## 6. Triggering & Effect Dilution

### The Math of Dilution
If an experiment alters a checkout step that only 10% of website visitors ever reach:
- If you randomize and analyze all website visitors, 90% of your sample received identical experiences in both Control and Treatment.
- The observed treatment effect is diluted by $10\times$ ($\text{Lift}_{\text{all}} = 0.10 \times \text{Lift}_{\text{triggered}}$).
- Because required sample size scales with $1 / (\text{effect})^2$, analyzing untriggered users requires **$100\times$ more sample size** to achieve the same statistical power!

### Best Practice
- **Triggered Analysis:** Record assignment at the earliest point of divergence (the moment the user triggers the feature or enters the relevant surface).
- Ensure the trigger condition itself is identical in Control and Treatment (counterfactual triggering) so triggering does not introduce an SRM.

---

## 7. Sample Ratio Mismatch (SRM)

### Why SRM Invalidates Everything
If an experiment plans a 50/50 split and observes 51,000 Control users vs 49,000 Treatment users, the chi-square test yields $p \approx 0.00004$ ($p < 0.001$).
- **Never ignore an SRM:** It indicates that the randomization mechanism, assignment, or tracking telemetry is compromised.
- Users who "went missing" in Treatment may have had high or low conversion propensities. Any observed lift between the surviving users is fundamentally uninterpretable.

### Common Root Causes
1. **Client-side performance / Redirection latency:** Treatment variant experiences a 200ms redirect or heavy JS initialization; impatient users bounce before the tracking beacon fires.
2. **Browser / Device Crashes:** Treatment causes silent crashes on older iOS or Android versions, dropping user telemetry.
3. **Bot / Web Crawler Filtering:** Bot filtering rules discard Treatment visits at different rates.
4. **Triggering / Eligibility Skew:** Triggering logic executed post-assignment contains variant-specific conditional code.
5. **Cookie / ID Churn:** Treatment creates new sessions or resets cookies, causing users to be double-counted or switched.

---

## 8. Minimum Test Duration & Day-of-Week Seasonality

### Why Sample Size Is Not the Only Stopping Rule
A high-traffic site might achieve its calculated sample size in 36 hours. **Stopping on day 2 is a critical error:**
1. **Day-of-Week Seasonality:** User demographics and intent differ dramatically between Monday morning and Saturday night. A test running Wednesday to Friday misses weekend dynamics.
2. **Novelty Effect:** Returning users interact with new buttons or layouts out of curiosity. This novelty lift typically decays within 7–14 days.
3. **Primacy Effect:** Users familiar with the existing layout struggle initially with a new interface, causing an artificial temporary drop that recovers after learning.
- **Rule:** Every online experiment must run for a minimum of **7 full consecutive days** (preferably 14 days) to capture full weekly cycles, regardless of when sample size is reached.

---

## 9. A/A Testing & System Health Validation

### Why A/A Tests Are Mandatory
An A/A test runs identical Control experiences against each other.
- **Uniform p-values:** When testing $H_0$ repeatedly in A/A tests, p-values must follow a standard uniform distribution ($U[0, 1]$).
- If an experimentation engine rejects $H_0$ at $\alpha = 0.05$ in 15% of A/A tests, the false positive rate is calibrated incorrectly (due to clustering, unmodeled variance, or network leaks).
- Run periodic A/A tests to validate variance estimators, delta method implementations, and SRM detection.

---

## 10. Peeking & Sequential mSPRT

### The Risk of Continuous Monitoring
Fixed-horizon hypothesis tests assume a single analysis at the pre-registered sample size.
- If you check the p-value daily over a 20-day test and stop as soon as $p < 0.05$, your true false positive rate inflates to over 30%.
- **Sequential Testing (mSPRT):** If early stopping is required for business velocity, you must pre-register an mSPRT design (`sequential_check`). Always-valid confidence intervals widen to pay for the continuous monitoring guarantee.

---

## 11. Randomization Unit Mismatch & Clustered Standard Errors

### The Risk
Randomizing by User or Workspace while analyzing Sessions, Transactions, or Tasks as independent rows:
- Observations from the same user are strongly correlated (heavy users generate dozens of sessions with similar behavior).
- Treating them as independent i.i.d. observations artificially deflates standard errors, producing dangerously narrow confidence intervals and false "wins".
- **Remedy:** Always declare `randomization_unit` to apply cluster-robust standard errors or the delta method.

---

## 12. Stochastic Agent & LLM Eval Comparisons

### Pitfalls in Agent Benchmarking
- Evaluating an agent or prompt version on a single run per benchmark case is noise. Temperature $> 0$, tool latencies, and non-deterministic LLM sampling create large run-to-run variance.
- Require at least 5 repeated runs per version across the identical benchmark cases.
- Use **cluster bootstrap** on the paired cases when sample sizes are small or scores are discrete (0/1 pass rate), to account for correlated prompt behavior across runs.
