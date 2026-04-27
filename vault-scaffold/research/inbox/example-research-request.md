---
tags: [research-request]
created: 2026-04-12
status: example
---

# Example: How to write a research request

**To create a new request:** use Templater — `Ctrl+P` → *Templater: Create new note from template* → pick **research-request**. The note will open with `status: draft` so Claude ignores it while you write.

**To submit:** change `status: draft` → `status: pending` in the frontmatter. Claude picks it up on the next poll and moves it to `research/processed/` before it starts.

---

## Topic

*What do you want to understand?*

> Example: Which self-hosted password manager best fits a small household?

## Why I'm interested

*What's the context? What decision or project is this feeding into?*

> Example: Our family currently reuses passwords and shares them over iMessage. I want something self-hosted so our credentials aren't in a third-party cloud, but it needs to be easy enough for non-technical family members.

## What I already know

*Save research time by stating your starting point.*

> Example: I know Bitwarden is popular and there's a self-hosted variant called Vaultwarden. I've heard KeePass exists but isn't cloud-synced by default. I don't know how to evaluate security tradeoffs or what the backup story looks like.

## Scope

*What depth do you want?*

- [ ] Quick overview — concepts and options, 1-2 pages
- [ ] Structured deep-dive — multiple cross-linked pages with options analysis
- [ ] Implementation plan — ends with concrete steps I could actually follow

## Questions to answer

*Optional. If you have specific questions, list them.*

> - What's the difference between Vaultwarden (Bitwarden-compatible) and the official Bitwarden server?
> - Does KeePass work well for non-technical family members on mobile?
> - What's the recommended backup strategy for a self-hosted password vault?

---

*Once filled in: Claude reads this file, may add a `## Clarifying Questions` section below, then builds the research output in `research/<topic>/`.*
