---
name: data-exploration
description: Explore local CSV or JSON and Databricks Unity Catalog. Use when profiling a table, writing SQL, listing catalogs, schemas, or tables, or checking a hypothesis against data.
---

# Data exploration

Finish when the answer cites the statement or file you ran, names what you did not measure, and records a finding when the result matters.

1. Confirm the source. Databricks questions use the live connection. If it is absent, call `connect_data_source`. Local questions name a CSV or JSON path.
2. Discover before you filter. On Databricks, call `discover_data` in order: catalogs, schemas, tables, then describe. Every statement uses `catalog.schema.table`.
3. Profile next. `profile_table` for a warehouse table, `load_dataset` for a local file. Stop if the table or file is missing.
4. Query only after the profile. `query_data` and `query_data` are read-only. Put the hypothesis in the rationale.
5. Write the hypothesis with `manage_hypotheses` and the observation with `record_finding`. Ask `request_auditor_review` before treating a finding as confirmed.
