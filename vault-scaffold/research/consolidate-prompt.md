---
tags: [system, research, prompt]
created: 2026-06-06
description: "Prompt template for [!consolidate] callout tasks. Synced from rockybot scaffold on bot restart — see info callout for edit policy."
---

# Consolidate Prompt

> [!info] How edits to this file behave
> This file is replaced on bot restart from `vault-scaffold/research/consolidate-prompt.md` in the rockybot repo. Edits made here in Obsidian take effect on the next watcher run but will be overwritten on the next bot restart — your previous version is saved to `research/.prompts-backup/consolidate-prompt-<timestamp>.md` so nothing is lost. To make changes permanent, edit the scaffold in the rockybot repo and ship a new bot version.

The consolidate watcher sends this prompt to Claude when it finds a `> [!consolidate]` callout in a research file. Use this callout to merge two or more topic folders into one — for example, folding a one-off research topic into a larger project, or combining thin overlapping topics.

The token `{{FILE_PATH}}` is substituted with the **target** file's absolute path (the file that contains the callout — this is the topic you are merging **into**). `{{VAULT_PATH}}` is the vault root.

**Callout format:**

```
> [!consolidate]
> Merge research/projects/mandarin-for-china-trip into this topic.
> Fold content into a "Language & Communication" section. Archive source after.
```

The instruction text (the lines following `> [!consolidate]`, still prefixed with `>`) tells Claude which source topic(s) to merge and any structural guidance. Source topics are given as vault-relative paths.

To insert a `[!consolidate]` callout, use the **Consolidate Task** template:
`Ctrl/Cmd+P` → "Templates: Insert template" → `Consolidate Task`

---

You are maintaining a personal research wiki. The file at {{FILE_PATH}} contains a `> [!consolidate]` callout block.

This is a **topic consolidation directive**: merge one or more source research topics into this target topic, following the instruction in the callout.

Vault root: {{VAULT_PATH}}

---

## Your task

### Step 1 — Read the target file and extract the instruction

Read {{FILE_PATH}}. Find the `> [!consolidate]` callout block. The instruction text is the line(s) **immediately following** the `> [!consolidate]` line, still prefixed with `>`. Extract the source topic path(s) and any structural guidance from the instruction.

Source topic paths are vault-relative (e.g. `research/projects/mandarin-for-china-trip`). Resolve each to an absolute path: `{{VAULT_PATH}}/research/projects/mandarin-for-china-trip/`.

### Step 2 — Read both topics in full

Read all `.md` files in the source topic folder(s) and the target topic folder (`{{FILE_PATH}}` and its siblings). Build a mental map of: what content exists in the source, what already exists in the target, and what the instruction says to do structurally.

Use Glob to enumerate files in each topic directory.

### Step 3 — Merge source content into the target

Following the instruction's structural guidance:

1. **Add or update sections in the target** to incorporate the source content. If the instruction names a section (e.g. "Language & Communication"), create it if it doesn't exist and place the merged content there.
2. **Keep existing target content intact** — only add or update; never remove target content unless the instruction explicitly says to.
3. **For multi-page source topics** — if the source has sub-pages, either:
   - Inline the relevant content into the target's existing pages, or
   - Move the sub-pages into the target folder if they represent distinct enough topics to remain separate (use your judgment; prefer inlining for small topics)
4. **Update `updated:` frontmatter** on every file you touch to today's date (YYYY-MM-DD). If no `updated:` field exists, add one after `created:`.
5. **Set file permissions** after each write:
   ```
   chmod o+r <file-path>
   ```

### Step 4 — Update wikilinks pointing to the source topic

After moving content, find all `.md` files in the vault that link to the source topic and update them to point to the correct target location.

Use Grep to find all occurrences of `[[research/...<source-topic-name>` across `{{VAULT_PATH}}`. For each match, update the wikilink to point to the target location. If the source had sub-pages that were moved into the target folder, update those links too.

```
grep -r "source-topic-name" {{VAULT_PATH}} --include="*.md" -l
```

Edit each file that has stale links.

### Step 5 — Archive the source topic

Move the source topic folder to `{{VAULT_PATH}}/research/archive/<source-topic-name>/`:

```bash
mv {{VAULT_PATH}}/research/<bucket>/<source-topic-name> {{VAULT_PATH}}/research/archive/<source-topic-name>
chmod -R o+r {{VAULT_PATH}}/research/archive/<source-topic-name>
```

If any files were already moved from the source into the target in Step 3, only move the remaining files (or the empty folder if everything was inlined). Do not move files that now live in the target.

Update the archived topic's `index.md` to add a note at the top:

```markdown
> **Archived** — content merged into [[research/<target-path>/index]] on <YYYY-MM-DD>.
```

### Step 6 — Remove the [!consolidate] callout from the target file

In {{FILE_PATH}}, remove the entire `> [!consolidate]` callout block (including all `>` prefixed instruction lines) — no trace left. The file should look as if the callout was never there.

Then update `updated:` frontmatter on {{FILE_PATH}} to today's date.

Fix permissions:
```
chmod o+r {{FILE_PATH}}
```

### Step 7 — Write a journal entry

Insert a new entry at the **top** of `{{VAULT_PATH}}/research/journal.md` (most recent first, after the opening `---` line, before the first existing `## ` heading). Format:

```markdown
## <YYYY-MM-DD> — Consolidated: <source topic> → <target topic>

**Source**: [[research/<relative-path-to-source>]]
**Target**: [[research/<relative-path-to-target>]]
**Type**: Topic consolidation

<2–4 sentences>: What was merged? What sections were added or updated in the target? Where was the source content placed?
```

---

File to process: {{FILE_PATH}}
