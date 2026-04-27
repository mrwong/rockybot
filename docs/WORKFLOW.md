# Workflow Guide

rockybot watches your Obsidian vault and uses Claude to process research requests and inline tasks. This guide covers how to use each feature.

---

## New research: inbox watcher

**How it works:**

```
You write a research request → research/inbox/<topic>.md
  tags: [research-request], status: pending
       │
       ▼ (every 10 minutes)
rockybot finds the pending request
  Sets status: processing
  Moves seed file to research/processed/<topic>.md  ← before Claude runs
  Invokes Claude with your research-prompt.md template
       │
       ▼
Claude writes output into research/<topic>/
  Creates index.md + sub-pages
  Updates research/journal.md (temporal log)
  Updates research/index.md
  Sets status: completed in the processed/ copy
       │
       ▼
Obsidian syncs the new pages to your devices
```

> **Why move the seed file early?** Obsidian Sync can conflict-resolve a file back to `status: pending` while Claude is writing output. Moving the seed out of `inbox/` before Claude starts means Obsidian no longer owns that document during processing.

**What happens after Claude writes the new pages:**

Claude doesn't stop at creating the new folder. It runs a final backlink pass — the **Karpathy ingest pass** — where it re-reads the existing research tree and updates 5–10 related pages to reference the new topic. This is the mechanic that makes the wiki compound: new knowledge propagates backward into what already exists, not just forward into new pages. Over time the graph gets denser and more navigable with each ingest, rather than growing as a collection of isolated documents. See [README.md](../README.md) for more on the inspiration behind this.

**Writing a request:**

Use the **Research Request** Obsidian template (`Cmd/Ctrl+P` → Templates → Research Request), or copy `research/inbox/example-research-request.md`.

Fill in:

| Section | Purpose |
|---|---|
| **Topic** | The core question you want answered |
| **Why I'm interested** | Context — what decision or project this feeds into |
| **What I already know** | Prevents Claude from re-explaining your starting point |
| **Scope** | Check one: quick overview / structured deep-dive / implementation plan |
| **Questions to answer** | Optional specific questions |

Then set `status: pending` in the frontmatter and save. rockybot picks it up within 10 minutes.

**Status machine:**

| Status | Meaning | What to do |
|---|---|---|
| `draft` | You're still writing | Nothing — watcher skips `draft` |
| `pending` | Ready to process | Wait up to 10 min |
| `processing` | File moved to `processed/`; Claude is running | Do not edit |
| `completed` | Research done | Read the output in `research/<topic>/` |
| `awaiting-input` | Claude needs clarification; file moved back to `inbox/` | Answer the `## Clarifying Questions` section, reset status to `pending` |
| `error` | Claude failed; file moved back to `inbox/` | Check `docker logs rockybot`; fix and reset to `pending` |

---

## Inline amendment: `[!claude]` callout

The amend watcher scans all research pages for `> [!claude]` callouts and performs targeted inline tasks.

**Usage:**

1. Open any research page in Obsidian
2. Place the cursor where you want the task to apply
3. Insert the callout (use the **Claude Task** template for a shortcut):

```
> [!claude]
> Your instruction here.
```

4. Save. Within 10 minutes Claude reads the file, performs the task, removes the callout, and bumps the `updated:` date in the frontmatter.

**Example instructions:**
- `Expand this section with more detail on the tradeoffs.`
- `Find related pages in this vault and add wikilinks throughout.`
- `Research current pricing for these options and update the comparison table.`
- `Split this long section into two separate headings.`

**Budget:** `$0.50` per amended file (configurable via `AMEND_BUDGET_USD`). For heavy tasks, use multiple smaller callouts or raise the budget.

---

## Create a sub-page: `[!expand]` callout

The expand watcher creates a new dedicated sub-page from an inline callout.

**Usage:**

Insert a `[!expand]` callout, then write the instruction for the new page in the paragraph immediately following:

```
> [!expand]

Write a full comparison of Vaultwarden vs. Bitwarden, covering resource requirements,
feature parity, and security audit status.
```

The instruction text (the paragraph after the callout, not prefixed with `>`) is the brief. Claude creates a new `.md` file in the same directory, then replaces the callout and instruction with a wikilink to the new page.

Use the **Expand Task** template for a shortcut.

**Budget:** `$1.00` per expand task (configurable via `EXPAND_BUDGET_USD`).

---

## Corpus revision: `[!revise]` callout

The revise watcher is for corpus-level rewrites — when foundational context changes and you need multiple sub-pages updated to reflect it.

**Usage:**

Add a `[!revise]` callout to a topic's `index.md`, followed by the new context:

```
> [!revise]

We've decided to go with Vaultwarden instead of KeePass. Update all sub-pages to
reflect this decision — remove KeePass-specific setup steps and focus on Vaultwarden.
```

Claude discovers all `[[wikilink]]` sub-pages referenced from the file, revises each in-place to reflect the new context, then removes the callout from the index.

Use the **Revise Task** template for a shortcut.

**Budget:** `$4.00` per revise task (configurable via `REVISE_BUDGET_USD`). Budget is higher because multiple files are revised in one run.

---

## Wiki audit: lint trigger

The lint watcher audits the full research wiki when triggered.

**To trigger a lint pass:**

Open `research/lint-trigger.md` in Obsidian and set:

```yaml
status: pending
```

Within 10 minutes, Claude audits the wiki for orphaned pages, broken wikilinks, and disconnected clusters, then writes a report to `research/lint-report.md` and resets the trigger to `status: done`.

**Budget:** `$5.00` per lint pass (configurable via `LINT_BUDGET_USD`).

---

## Output structure

```
research/
  inbox/
    my-topic.md          ← seed while pending/awaiting-input/error
  processed/
    my-topic.md          ← seed archived here on completion
  my-topic/
    index.md             ← overview, TL;DR, wikilinks to sub-pages
    options-comparison.md
    implementation.md
    tradeoffs.md
    ... (varies by scope)
  index.md               ← updated with each new topic
  journal.md             ← temporal log of research activity
  research-prompt.md     ← editable; controls new research behavior
  amend-prompt.md        ← editable; controls [!claude] behavior
  expand-prompt.md       ← editable; controls [!expand] behavior
  revise-prompt.md       ← editable; controls [!revise] behavior
  lint-prompt.md         ← editable; controls lint pass behavior
  lint-trigger.md        ← set status: pending to run a lint pass
```

---

## Editable prompts

All prompt templates live in your vault and can be edited directly in Obsidian. rockybot reads them on each poll cycle — no restart needed to change bot behavior.

| File | Controls |
|---|---|
| `research/research-prompt.md` | How Claude researches and structures new topics |
| `research/amend-prompt.md` | How Claude handles `[!claude]` inline tasks |
| `research/expand-prompt.md` | How Claude creates sub-pages from `[!expand]` |
| `research/revise-prompt.md` | How Claude performs corpus revision via `[!revise]` |
| `research/lint-prompt.md` | How Claude audits the wiki |

If a vault prompt file is missing or deleted, rockybot falls back to the built-in default prompt baked into the image.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Request stays `pending` for 10+ min | Bot not running, or error during poll | Check `docker logs rockybot --tail 50` |
| File stuck with `status: processing` | Bot crashed after status write | Auto-recovered on next poll — resets to `pending` and retries |
| Status set to `error`; file back in inbox | Claude failed | Check `docker logs rockybot` for the error; verify `ANTHROPIC_API_KEY` is set |
| Discord alert: "Claude auth expired" | Claude subscription session lapsed | Re-run `claude login` on the Docker host; alert fires at most 2× per day |
| `[!claude]` callout not processed | Regex didn't match | Ensure callout is `> [!claude]` at the **start of a line**, not inside a code block |
| Callout processed but output poor | Budget exhausted mid-task | Raise `AMEND_BUDGET_USD`, or split into smaller callouts |
| Prompt edits not taking effect | Edited the wrong file | Edit the vault copy (`research/*-prompt.md`), not the image scaffold |
| Output not appearing in Obsidian | Sync delay | Wait 1–2 min for Obsidian Sync; check that Obsidian is connected |
