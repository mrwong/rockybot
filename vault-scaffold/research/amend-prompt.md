---
tags: [system, research, prompt]
created: 2026-04-17
description: "Prompt template for [!claude] inline amendment tasks. Edit here to change how Claude handles callout tasks."
---

# Amend Prompt

This is the prompt template the research amend watcher sends to Claude when it finds a `> [!claude]` callout in a research file. Edit this file in Obsidian to change how amendments are handled — the watcher reads it live from the vault on each run.

The token `{{FILE_PATH}}` is substituted with the target file's absolute path before the prompt is sent.

To insert a `[!claude]` callout quickly, use the **Claude Task** template:
`Ctrl/Cmd+P` → "Templates: Insert template" → `Claude Task`
Or if you have Templater: assign a hotkey to "Templater: Insert templates/claude-task.md".

---

You are editing an existing research note in a personal knowledge base wiki.

The file at {{FILE_PATH}} contains one or more `> [!claude]` callout blocks.
Each callout is an inline task — expand, link, research, or restructure that
specific part of the file.

Vault root: {{VAULT_PATH}}

---

## Your task

### Step 1 — Read the file

Read {{FILE_PATH}} and identify every `> [!claude]` callout block and the
instruction it contains. Note the position of each callout relative to surrounding
headings so you know what section each task applies to.

### Step 2 — Perform each task

For each callout, do exactly what it asks. Common task types:

- **Expand**: add depth, detail, examples, sub-headings, or concrete commands/code
- **Link**: use Glob to find existing vault pages, add `[[wikilinks]]`; if the target
  page doesn't exist yet, create a stub and link it
- **Research**: use WebSearch/WebFetch for current information; **inline hyperlinks are
  mandatory** — `[anchor text](url)` in body text every time you cite a source, AND
  add to the frontmatter `sources:` list
- **Restructure**: reorganise sections, split into sub-pages, etc.
- **Connect**: find related existing research pages (Glob `research/*/index.md`) and
  add cross-links in both directions

You may READ other vault files for context. Only WRITE to the target file unless the
task explicitly asks you to create or update other files.

### Step 3 — Remove completed callouts

After completing each task, **delete the entire `> [!claude]` callout block** from
the file. The improved content replaces it — no trace left behind.

If you could only partially complete a task (e.g. web search returned limited results),
replace the `[!claude]` type with `[!warning]` and note what remains to be done, so
it is visible but no longer triggers the watcher.

### Step 4 — Update frontmatter

Set the `updated:` field in the file's frontmatter to today's date (YYYY-MM-DD).
If the file has no `updated:` field, add one after the existing frontmatter fields.

### Step 5 — Update the research journal

Append a new entry at the **top** of `{{VAULT_PATH}}/research/journal.md` (most recent first,
after the opening `---` line, before the first existing `## ` heading). Format:

```markdown
## <YYYY-MM-DD> — Amended: <one-phrase description of what changed>

**File**: [[research/<relative-path-without-vault-prefix>]]
**Type**: Inline amendment

<1–2 sentences>: What did the callout ask for, and what was changed or added?
```

---

### Step 6 — Fix permissions

After writing the file, run:
```
chmod o+r {{FILE_PATH}}
```

---

File to amend: {{FILE_PATH}}
