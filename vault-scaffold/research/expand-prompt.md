---
tags: [system, research, prompt]
created: 2026-04-19
description: "Prompt template for [!expand] callout tasks. Edit here to change how Claude creates new sub-pages."
---

# Expand Prompt

This is the prompt template the research expand watcher sends to Claude when it finds a `> [!expand]` callout in a research file. Edit this file in Obsidian to change how expand tasks are handled — the watcher reads it live from the vault on each run.

The token `{{FILE_PATH}}` is substituted with the target file's absolute path before the prompt is sent.

To insert a `[!expand]` callout quickly, use the **Expand Task** template:
`Ctrl/Cmd+P` → "Templates: Insert template" → `Expand Task`

---

You are editing a research note and creating new sub-pages in a personal knowledge base wiki.

The file at {{FILE_PATH}} contains one or more `> [!expand]` callout blocks.

Each callout is a request to **create a new dedicated sub-page** on a topic. The instruction text appears in the paragraph(s) **immediately following** the callout block (text not prefixed with `>`).

Vault root: {{VAULT_PATH}}

---

## Your task

### Step 1 — Read the file

Read {{FILE_PATH}} and identify every `> [!expand]` callout block. For each one, read the paragraph(s) immediately after the callout (before the next heading, `---` separator, or blank line followed by a `>` or `#`) — that text is the instruction describing what the new sub-page should contain.

### Step 2 — Create the new sub-page

For each expand callout:

1. **Derive a filename** from the instruction topic — lowercase, hyphen-separated, no special characters (e.g. "local inference hardware" → `local-inference-hardware.md`). The new file goes in the **same directory** as the source file.

2. **Write the new page** as a full, well-researched Obsidian wiki page:
   - Frontmatter with `tags`, `created` (today: YYYY-MM-DD), `related` wikilinks back to the source file, and a `sources:` list
   - A `# Title` heading
   - A `## TL;DR` section (3-5 sentences, the key takeaway)
   - All content requested in the instruction, with appropriate sub-sections
   - **Inline hyperlinks are mandatory** — `[anchor text](url)` every time you cite a source, AND add each URL to the frontmatter `sources:` list
   - Use WebSearch/WebFetch to get current, accurate information
   - A `## See Also` section with wikilinks to related vault pages (use Glob to find them)

3. **Set file permissions** after writing:
   ```
   chmod o+r <new-file-path>
   ```

### Step 3 — Update the source file

In {{FILE_PATH}}:

1. **Replace the `[!expand]` block and its instruction paragraph** with a one-line link entry pointing to the new page:
   ```
   - [[filename]] — one-sentence description of what the new page covers
   ```
   Add this link under the nearest `## Pages` section if one exists, or directly in place of the callout if not.

2. Also add the new page to the `## Pages` section if the file has one.

3. Remove the expand callout block and instruction text entirely — no trace left.

### Step 4 — Update frontmatter

Set the `updated:` field in {{FILE_PATH}} to today's date (YYYY-MM-DD). If no `updated:` field exists, add one after the existing frontmatter fields.

### Step 5 — Update the research journal

Append a new entry at the **top** of `{{VAULT_PATH}}/research/journal.md` (most recent first,
after the opening `---` line, before the first existing `## ` heading). Format:

```markdown
## <YYYY-MM-DD> — Expanded: <new page title>

**Output**: [[research/<relative-path-to-new-page>]]
**Source**: [[research/<relative-path-to-source-file>]]
**Type**: Page expansion

<1–2 sentences>: What new page was created, and what does it cover?
```

---

### Step 6 — Fix permissions on source file

```
chmod o+r {{FILE_PATH}}
```

---

File to process: {{FILE_PATH}}
