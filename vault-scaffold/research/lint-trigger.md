---
tags: [system, research, lint]
created: 2026-04-18
status: idle
---

# Lint Trigger

Set `status: pending` to run a lint pass on the research wiki.

The bot checks this file on its poll interval (every 10 minutes). When it sees `status: pending` it runs Claude against the full wiki, then:
- Writes a report to `research/lint-report.md`
- Sets this file back to `status: completed`

**To run a lint pass:** change `status: idle` to `status: pending` and save.

---

| Field | Value |
|---|---|
| Last run | — |
| Report | [[research/lint-report]] |
