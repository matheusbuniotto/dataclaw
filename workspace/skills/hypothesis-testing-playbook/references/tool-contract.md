# Tool contract

The skill expects an MCP server exposing these tools (such as `tea-tasting-tools`). Argument names may differ slightly; match by semantic meaning. "kw" marks keyword-only arguments.

| Tool | Inputs | Outputs used by the skill |
|---|---|---|
| `design` | hypothesis, primary_metric {name, type, numer, denom}, guardrails [{metric, category, acceptable_harm, hard_stop}], trial_type (superiority, non_inferiority, equivalence), non_inferiority_margin, unit, alpha (0.05), mde_rel, direction, min_duration_days | plan_id, preregistration_md |
| `power` | metric, baseline_mean, baseline_std, mde_rel, alpha (0.05), power (0.8), ratio (1.0), cuped_r2, non_inferiority_margin (None) | n_per_arm, total_n, assumptions |
| `analyze` | data_ref, variant_col, metrics, control, covariates (CUPED), multiple_testing: none, holm, or bh (Holm by default when segment_col is set), robust {winsorize_pct, test: yuen}; kw: alpha, srm_alpha (0.001), randomization_unit (None), segment_col (None), n_resamples (10000), seed (0), non_inferiority_margin (None) | top level: results, warnings, srm, randomization_unit, segment_col, segments. Each result: metric, segment, randomization_unit, control, treatment, abs_effect, abs_ci, rel_effect, rel_ci, pvalue, pvalue_adj, significant, non_inferior, method. Each srm entry: control_variant, treatment_variant, observed, pvalue, is_srm, alpha, method, segment |
| `srm_check` | counts {variant: n}, expected_ratio, alpha (0.001) | pvalue, is_srm, observed, expected |
| `sequential_check` (opt-in) | looks, metric_type: mean or proportion, alpha (0.05), tau2, mde_abs, mde_rel, max_n_per_arm | looks[], always_valid_ci, always_valid_pvalue, effect, decision: continue, stop_reject, or stop_max_n, stopped_at_look, alpha, method, assumptions, warnings |
| `compare_eval_runs` | scores_a [runs][cases], scores_b, paired (true), alpha (0.05), ci_method: analytic or cluster_bootstrap, n_resamples (5000), seed (0) | mean_a, mean_b, diff, ci, pvalue, run_to_run_std_a, run_to_run_std_b, n_cases, n_runs, method; with cluster_bootstrap, pvalue and significant are bootstrap-based, plus ci_analytic, pvalue_analytic, n_resamples, seed |
| `report` | plan_id, results, srm, sequential, audience: technical or stakeholder. Accepts `sequential` alone. | markdown (segment rows shown as exploratory; headline from results when given, from sequential only when results is empty; includes guardrail health and non-inferiority status) |

## Metric types in `analyze`

| Type | Extra field | Method | p-value |
|---|---|---|---|
| mean, proportion | | t-test, CUPED if covariates | yes |
| ratio | numer, denom | delta method; per-cluster ratio of means with randomization_unit | yes |
| quantile | q | `bootstrap: ...` | null: read CI and `significant` |
| bootstrap | statistic: mean, median, std, trimmed_mean_10 | `bootstrap: ...` | null: read CI and `significant` |

## Field details

- `analyze.significant`, every row: adjusted p (raw if no correction) < alpha; null if p is NaN; for quantile and bootstrap rows, CI excludes 0. Quantile and bootstrap rows also have rel_effect and rel_ci.
- `analyze.non_inferior`: true if lower bound of relative/absolute CI exceeds `-non_inferiority_margin`.
- `analyze.srm`: one entry per comparison (and segment). Always assumes a 1:1 split, so an intended unequal split shows as SRM: use `srm_check` with `expected_ratio` instead.
- `multiple_testing="none"` with `segment_col` overrides Holm: pvalue_adj null plus a likely-false-positive warning. Do not use it.
- `sequential_check.looks`: list of dicts, cumulative per-arm stats in time order, at least 2 units per arm. Always n_control, n_treatment, mean_control, mean_treatment. For `mean`, also std_control and std_treatment (standard deviation, not variance). For `proportion`, means are rates in [0, 1]; counts raise an error.
- `tau2` precedence: explicit tau2, then mde_abs squared, then (mde_rel times mean_control of the first look) squared. Pre-register whichever one you use.
- `compare_eval_runs` with cluster_bootstrap: p-value floor is 1/(n_resamples+1). At the floor, report "p ≤ [pvalue]".

## Errors and warnings that change what you do

- `ValueError`, unit in more than one variant: assignment bug. Stop, treat like an SRM.
- Warning, repeated ids without a declared unit: declare `randomization_unit` as a labeled deviation.
- Warning, exploratory segments: repeat it; segment rows do not decide ship.
- Guardrail threshold exceeded: trigger hard stop or mark as "Win with Trade-off Cost".

## When a tool is missing or fails

- State which tool is unavailable and what statistics it would have produced.
- Do not invent numbers or calculate estimates in prose. If the user has a Python environment with tea-tasting or scipy/statsmodels and asks you to compute them, you may execute code and cite its printed output as the verifiable source.
- Statistical discipline still applies fully: pre-register, check Twyman's Law, verify SRM, enforce minimum 1–2 week cycles, and evaluate guardrails.
