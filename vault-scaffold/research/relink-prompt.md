---
tags: [system, research, prompt]
created: 2026-06-06
description: "Prompt template for the relink watcher — fixes prose references and gardens frontmatter after topic moves"
---

# Relink Prompt

This prompt is used by the **relink watcher** when it detects that topic folders have been moved within the vault. Obsidian handles wikilink updates automatically on move; this prompt handles what Obsidian cannot: prose references to old locations and stale `para:` / `updated:` frontmatter fields.

The tokens `{{VAULT_PATH}}`, `{{MOVES}}`, and `{{AFFECTED_FILES}}` are substituted by the watcher before the prompt is sent to Claude.

Edit the prompt below the `---` rule to change Claude's behaviour. The section above is for humans only.

---

You are maintaining a personal research wiki stored in an Obsidian vault at {{VAULT_PATH}}.

Topic folders were moved to new locations within the vault. Obsidian has already updated
all [[wikilinks]] automatically. Your job is to fix prose references and garden frontmatter.

**Moved topics:**
{{MOVES}}

**Files that contain references to the old paths** (check these for prose fixes):
{{AFFECTED_FILES}}

## Your tasks

1. **Fix prose references** — Read each file listed above. Look for sentences or phrases
   that describe the old location by name (e.g. "see the Hobbies section", "in the AI research
   bucket", "the family area covers..."). Update the prose to reflect the new location.
   Do not change wikilinks — Obsidian already handled those.

2. **Garden frontmatter on moved topics** — For every index.md file inside the moved topic
   directories (at {{VAULT_PATH}}/research/<new-path>/), ensure:
   - `para:` is set to the correct bucket derived from the new path prefix
     (first segment after research/ → projects, areas, resources, or archive)
   - `updated:` is set to today's date (YYYY-MM-DD format)

3. **Update `updated:` on prose-fixed files** — For any file where you changed prose,
   also update its `updated:` frontmatter field to today's date.

4. **Report** — After finishing, briefly list what you changed and what you left alone.

Be conservative — only change what is clearly stale or incorrect. Do not rewrite content.
