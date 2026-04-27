---
tags: [system, research, prompt]
created: 2026-04-18
description: "Prompt template for the lint pass. Runs when research/lint-trigger.md is set to status: pending."
---

# Lint Prompt

This is the prompt template the research watcher sends to Claude when `research/lint-trigger.md` has `status: pending`. Edit this file in Obsidian to change how Claude performs the lint pass.

The token `{{VAULT_PATH}}` is substituted by the watcher before the prompt is sent.

---

You are performing a structural lint pass on a personal knowledge base wiki.

Vault root: {{VAULT_PATH}}
Wiki root: {{VAULT_PATH}}/research/

Your job is to audit the wiki for health issues, fix what you can directly, and write a structured report.

---

## Step 1 — Enumerate the wiki

Use Glob to list all `.md` files under `{{VAULT_PATH}}/research/`, excluding:
- `inbox/`
- `processed/`
- `research-prompt.md`, `amend-prompt.md`, `lint-prompt.md`
- `lint-trigger.md`, `lint-report.md`

Build a complete list of pages. These are the pages you will audit.

---

## Step 2 — Build a backlink map

Read every page. For each page, extract all `[[wikilinks]]` it contains. Build two maps:

- **outlinks**: page → list of pages it links to
- **backlinks**: page → list of pages that link to it

Normalize link paths: a link like `[[research/foo/bar]]` or `[[foo/bar]]` refers to `research/foo/bar.md` relative to the vault root.

---

## Step 3 — Identify issues

Check for:

**Orphaned pages** — pages with zero backlinks (nothing links to them). These are invisible from the rest of the wiki. Exception: `index.md` files at the root of a topic folder don't need backlinks.

**Broken links** — `[[wikilinks]]` that point to a path that doesn't exist as a file in the vault. These are dead links.

**Disconnected topic clusters** — topics that share obvious conceptual overlap but have no cross-references between them. Use the page titles and tag fields to spot these.

**Missing index backlinks** — pages within a topic folder (`research/<topic>/foo.md`) that don't have a `> Back to [[research/<topic>/index]]` link or equivalent.

---

## Step 4 — Fix what you can directly

For each issue where the fix is unambiguous and low-risk:

- **Broken link** pointing to a file that was renamed: fix the link path.
- **Orphaned page**: add a reference from the most relevant related page or its topic index.
- **Missing index backlink**: add `> Back to [[research/<topic>/index]]` near the top of the page (after the first heading).

Do not rewrite prose. Only add or fix links. If fixing an issue requires editorial judgment (e.g. you're not sure which page should link to an orphan), flag it in the report instead.

---

## Step 5 — Write the lint report

Write a complete report to `{{VAULT_PATH}}/research/lint-report.md`. Structure:

```markdown
---
tags: [system, research, lint]
updated: <today's date YYYY-MM-DD>
---

# Wiki Lint Report

**Run date:** <today's date>
**Pages audited:** <N>

## Summary

<2-3 sentence health assessment. Is the wiki in good shape? What's the main issue?>

## Issues Found and Fixed

<List each issue that was fixed directly. Format:>
- **[Fixed]** `research/foo/bar.md` — broken link `[[research/foo/baz]]` corrected to `[[research/foo/qux]]`

## Issues Flagged (needs your attention)

<List each issue that needs editorial judgment. Format:>
- **[Orphan]** `research/foo/bar.md` — no pages link to it; consider linking from `research/foo/index.md`
- **[Disconnected]** `research/topic-a/` and `research/topic-b/` share overlap but no cross-references

## Backlink Coverage

<A brief table or list showing pages with zero or one backlinks. Skip pages that are fine.>

## Notes

<Anything else worth flagging — stale dates, pages that look incomplete, etc.>
```

---

## Step 6 — Mark the trigger complete

Edit `{{VAULT_PATH}}/research/lint-trigger.md`:
- Set `status: completed`
- Set `completed: <today's date YYYY-MM-DD>`
