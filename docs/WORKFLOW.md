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

## Exporting a topic

You can download any published topic as a self-contained ZIP for offline reading or sharing with people who don't have access to your notes server.

**How it works:**

On the notes-web root index (`http://notes.yourdomain/`), each published topic has a **⬇ Export ZIP** link next to it. Click the link to download that single topic as a `.zip` file immediately — generation takes under a second for typical topics.

The single-topic ZIP contains:
- All rendered HTML pages for the topic (index + sub-pages)
- Quartz CSS, JavaScript, and fonts so pages render correctly offline
- Cross-topic links converted to non-clickable text (the content is there, the link isn't)

Open the extracted `index.html` in any browser — no server, no internet required.

### Exporting several topics at once

The root index also has an **⬇ Export multiple topics as a ZIP** selector. Expand it, tick the topics you want, and click **⬇ Export selected** to download them all as one bundle.

The key difference from a single-topic export: **links between topics you include in the same bundle resolve locally.** Each topic keeps its own folder in the ZIP (`my-topic/`, `projects/penang-trip/`, …) with a shared stylesheet and a landing `index.html` listing everything included. A link from one included topic to another included topic works when you open the files offline; a link to a topic you *didn't* include is disabled (non-clickable, like the single-topic export). So if you want cross-references to survive, select all the related topics together.

**What doesn't work in either ZIP:**
- Full-text search (requires a server to build the search index)
- The interactive graph view (requires JS fetches)
- Links to topics not included in the bundle

**Security:** Only published topics (`publish: true` in `index.md`) can be exported. The export endpoint validates every requested slug against the current publish list on every request — revoking `publish: true` immediately blocks exports, even before the Quartz rebuild completes. A multi-topic request is all-or-nothing (any unpublished or unbuilt slug rejects the whole request) and is capped at 25 topics.

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

Prompt templates live in your vault as `research/*-prompt.md` and the watchers read them on each poll cycle. Editing in Obsidian takes effect on the next watcher run — but understand the sync policy below before relying on those edits.

| File | Controls |
|---|---|
| `research/research-prompt.md` | How Claude researches and structures new topics |
| `research/amend-prompt.md` | How Claude handles `[!claude]` inline tasks |
| `research/expand-prompt.md` | How Claude creates sub-pages from `[!expand]` |
| `research/revise-prompt.md` | How Claude performs corpus revision via `[!revise]` |
| `research/consolidate-prompt.md` | How Claude merges topics via `[!consolidate]` |
| `research/relink-prompt.md` | How Claude repairs links after topic moves |
| `research/lint-prompt.md` | How Claude audits the wiki |

### Sync policy on bot restart

Prompts are bot-controlled, not user-owned. On every bot startup the seeder compares each `*-prompt.md` against the image scaffold (`vault-scaffold/research/*-prompt.md`):

- **Match** → no-op.
- **Differ** → the live copy is moved to `research/.prompts-backup/<name>-YYYYMMDD-HHMMSS.md`, then replaced with the scaffold version.
- **Missing** → seeded from scaffold (no backup needed).

This means experimental edits in Obsidian are great for "try a tweak and see what happens on the next poll," but won't survive a bot restart. To make a prompt change permanent, edit the scaffold in the rockybot repo (`vault-scaffold/research/<name>-prompt.md`) and ship a new bot image.

If a vault prompt file is deleted, rockybot re-seeds it from the scaffold on the next restart. If both vault and scaffold are missing, the bot falls back to a built-in default prompt baked into the watcher code.

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
| Prompt edits work, then revert after a restart | This is the sync policy | Live prompts are replaced from the scaffold on bot restart (with backup to `research/.prompts-backup/`). For permanent changes, edit the scaffold in the rockybot repo and ship a new image. See [Editable prompts](#editable-prompts) |
| Output not appearing in Obsidian | Sync delay | Wait 1–2 min for Obsidian Sync; check that Obsidian is connected |
