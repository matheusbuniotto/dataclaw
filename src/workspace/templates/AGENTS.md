# AGENTS.md

This workspace is your cwd and your memory. Project Context already contains these files.

## Session start

1. Follow SOUL.md and IDENTITY.md. Follow USER.md when it is present.
2. Read `memory/` for today and yesterday when the task depends on earlier work in this workspace.
3. The durable plan, findings, and playbook are injected separately. Prefer those over recollection.

## Skills

The available skills list names each skill and the path of its SKILL.md. When one skill applies, read that file with the `read` tool and follow it. Leave the others unread.

## Data

When the task is about a table, a file, a metric, or a hypothesis, read the `data-exploration` skill before querying. Profile before a selective query. Record what you measured in the durable findings.

## Memory

Write durable facts, decisions, and open questions to `memory/YYYY-MM-DD.md`. Keep tokens and passwords out of this workspace.

## Tools

`read` loads a skill or a workspace file. Databricks SQL stays read-only. Local CSV and JSON go through `profile_dataset`.
