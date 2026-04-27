---
tags: [system, research, prompt]
created: 2026-04-21
description: "Prompt template for [!revise] callout tasks. Edit here to change how Claude revises an entire research section."
---

# Revise Prompt

This is the prompt template the research revise watcher sends to Claude when it finds a `> [!revise]` callout in a research file. Unlike `[!expand]` (which creates new pages) or `[!claude]` (targeted inline edits), `[!revise]` triggers a corpus-level review and revision of an entire section based on new context.

Edit this file in Obsidian to change how revise tasks are handled — the watcher reads it live from the vault on each run.

The token `{{FILE_PATH}}` is substituted with the source file's absolute path. `{{VAULT_PATH}}` is the vault root.

To insert a `[!revise]` callout, use the **Revise Task** template:
`Ctrl/Cmd+P` → "Templates: Insert template" → `Revise Task`

---

You are maintaining a personal research wiki. The file at {{FILE_PATH}} contains a `> [!revise]` callout block.

This is a **corpus-revision directive**: read the instruction text, then find and update all sub-pages in this research section to reflect the new context. You are editing existing files in-place — not creating new pages.

Vault root: {{VAULT_PATH}}

---

## Your task

### Step 1 — Read the source file and extract the instruction

Read {{FILE_PATH}}. Find the `> [!revise]` callout block. The instruction text is the paragraph(s) **immediately following** the callout (text not prefixed with `>`, before the next heading `#`, separator `---`, or blank line followed by `>` or `#`). This instruction is the new context/lens to apply across the section.

### Step 2 — Discover sub-pages

In the same file ({{FILE_PATH}}), find all `[[wikilink]]` references. Resolve each to an absolute path under `{{VAULT_PATH}}/` — strip the `[[` and `]]`, treat the wikilink as a relative path from the vault root, and append `.md` if no extension. For example: `[[research/password-managers/self-hosting-guide]]` → `{{VAULT_PATH}}/research/password-managers/self-hosting-guide.md`.

Only include files that actually exist. Use Glob if needed to verify.

### Step 3 — Revise each sub-page

For each resolved sub-page path:

1. **Read the file**
2. **Identify what needs to change** under the revision instruction — do not rewrite content that is still accurate; only update what the instruction changes
3. **Edit the file in-place** — use the Edit tool to make targeted changes:
   - Update facts, figures, itineraries, group compositions, or logistics that conflict with the new context
   - Remove or reframe sections that no longer apply
   - Keep the existing page structure (headings, sections, wikilinks) intact unless the revision requires structural changes
   - Use WebSearch/WebFetch to verify any facts you're unsure about before writing them
4. **Update `updated:` frontmatter** to today's date (YYYY-MM-DD). If no `updated:` field exists, add one
5. **Set file permissions**:
   ```
   chmod o+r <file-path>
   ```

### Step 4 — Remove the [!revise] callout from the source file

In {{FILE_PATH}}, remove the `> [!revise]` callout block and the instruction text that follows it entirely — no trace left. The source file should look as if the callout was never there.

Then update `updated:` frontmatter on {{FILE_PATH}} to today's date.

Fix permissions:
```
chmod o+r {{FILE_PATH}}
```

### Step 5 — Write a journal entry

Insert a new entry at the **top** of `{{VAULT_PATH}}/research/journal.md` (most recent first, after the opening `---` line, before the first existing `## ` heading). Format:

```markdown
## <YYYY-MM-DD> — Revised: <section title>

**Source**: [[research/<relative-path-to-source-file>]]
**Type**: Section revision

<2–4 sentences>: What new context was applied? Which sub-pages were updated and what specifically changed in each?
```

---

File to process: {{FILE_PATH}}
