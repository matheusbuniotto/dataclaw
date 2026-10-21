# Stats capabilities (version 1)

Contracts for `domain: "stats"` plugins. Types and output checks are in
`src/plugins/capabilities/stats.ts`. Inputs are plain arrays. DataClaw does the shaping
(for evals: a case is a task, a run is a repeat; see `evals/shape.ts`).

Every output carries `method` (a human-readable description of what was computed) and
`warnings` (strings). DataClaw prints both verbatim. Extra fields are allowed and ignored.

## `stats.compare_eval_runs@1`

Compare two eval configurations, each run several times over the same cases.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `scores_a`, `scores_b` | `number[][]` | runs × cases. `scores_x[r][j]` is run *r* of case *j*. Case order is the same in A and B. Run counts may differ. |
| `paired` | `boolean` | Cases are the same items in A and B. DataClaw always sends `true`. |
| `alpha` | `number` | Two-sided level. The CI is at `1 - alpha`. |
| `ci_method` | `"analytic"` \| `"cluster_bootstrap"` | Every provider must support `analytic`. `cluster_bootstrap` (resample cases, then runs within case) is optional; a provider without it returns an error. |
| `n_resamples`, `seed` | `number?` | For resampling methods. |

Output (required):

| Field | Type | Meaning |
| --- | --- | --- |
| `diff` | `number` | mean of B − mean of A. |
| `ci` | `[number, number]` | Interval for `diff`. |
| `pvalue` | `number \| null` | Two-sided p-value for `diff = 0`, or `null` if the method has none. |
| `run_to_run_std_a`, `run_to_run_std_b` | `number \| null` | Std of the per-run mean score (how much the headline number moves if you rerun the suite). `null` with one run. |
| `method`, `warnings` | `string`, `string[]` | |

Optional: `mean_a`, `mean_b`, `ci_level`, `n_cases`, `n_runs`.

`evals:compare` adds its own warnings before the plugin's: scripted-mode episodes, episode
errors, tasks that only one side ran, uneven repeats, and nominal cost.

## `stats.agreement_kappa@1`

Agreement between two raters labeling the same items (for example people vs the auditor).

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `rater_a`, `rater_b` | `string[]` | Same length. Item *i* got `rater_a[i]` and `rater_b[i]`. |
| `labels` | `string[]?` | Category order. Default: sorted union of both raters. |
| `alpha` | `number` | CI at `1 - alpha`. |
| `n_resamples`, `seed` | `number?` | For resampling CIs. |

Output (required):

| Field | Type | Meaning |
| --- | --- | --- |
| `kappa` | `number \| null` | Cohen's kappa. `null` when undefined (expected agreement is 1). |
| `ci` | `[number \| null, number \| null]` | Interval for kappa. |
| `agreement` | `number` | Raw share of items where the raters agree. |
| `confusion_matrix` | `number[][]` | Rows = `rater_a`, columns = `rater_b`, both in `labels` order. |
| `labels` | `string[]` | Order used. |
| `n` | `number` | Items compared. |
| `method`, `warnings` | `string`, `string[]` | Providers should warn when a rater used a single label (kappa is then 0 or undefined by construction). |

Optional: `kappa_se`.

`evals:calibrate score` sends human labels as `rater_a` and auditor verdicts as `rater_b`,
with `labels = ["confirmed", "caution", "rejected"]`.
