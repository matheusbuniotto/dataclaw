# Offline eval report (scripted agent, synthetic)

> Synthetic data. These episodes ran the real harness, tools, and SQLite engine, but the model was a
> scripted agent with failures injected at fixed rates (`evals/scripted-agent.ts`). The numbers check
> the measurement pipeline; they say nothing about the quality of any model. Costs use a nominal price.

| Metric | baseline | candidate |
| --- | --- | --- |
| Episodes (tasks × repeats) | 45 (9 × 5) | 45 (9 × 5) |
| Success rate [95% CI] | 84.4% [71.1%, 95.6%] | 91.1% [82.2%, 100.0%] |
| Tasks solved in every repeat | 44.4% | 66.7% |
| Tasks solved in any repeat | 100.0% | 100.0% |
| Success by repeat (min–max, sd) | 77.8%–88.9%, sd 6.1% | 77.8%–100.0%, sd 9.3% |
| Flaky tasks | 5 | 3 |
| Stuck rate [95% CI] | 26.7% [13.3%, 40.0%] | 2.2% [0.0%, 6.7%] |
| Stuck reasons | repeated_call: 12 | repeated_call: 1 |
| Success when stuck / not stuck | 50.0% / 97.0% | 100.0% / 90.9% |
| Answered despite a rejected finding | 11.1% | 0.0% |
| Tool calls per episode | 5.8 | 5.4 |
| Tool error rate | 20.2% | 25.3% |
| Tokens per episode | 103,149 | 100,176 |
| Cost per success [95% CI] | $0.02550 [$0.02323, $0.02952] (nominal) | $0.02417 [$0.02218, $0.02680] (nominal) |
| Latency p50 / p90 | 123 ms / 130 ms | 122 ms / 125 ms |

CIs are percentile bootstraps that resample tasks (2,000 draws), since repeats of one task are correlated.
Latency is wall clock on the machine that ran the evals and is not reproducible run to run.

## candidate vs baseline

| Check | Result |
| --- | --- |
| Sample ratio (planned 1:1) | 45 vs 45, χ² = 0.00, p = 1.000 |
| Success difference, Newcombe 95% CI | +6.7 pp [-7.5 pp, +20.9 pp] |
| Success difference, task bootstrap 95% CI | +6.7 pp [-11.1 pp, +24.4 pp] |
| Effect size (Cohen's h) | 0.21 |
| Stuck rate difference, task bootstrap 95% CI | -24.4 pp [-40.0 pp, -8.9 pp] |
| Cost per success difference, task bootstrap 95% CI | $-0.00133 [$-0.00622, $0.00299] |

The Newcombe interval treats episodes as independent; the task bootstrap does not, and is the one to read.
