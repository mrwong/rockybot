---
tags: [research, index]
created: 2026-04-12
---

# Research

Structured research on topics I'm exploring. Each topic gets its own folder with cross-linked pages.

## How research works

Drop a note in `research/inbox/` tagged `#research-request` with a topic and scope.
The research watcher (runs every 10 min) picks it up, Claude researches it, and builds output pages in `research/<topic>/`.

See [[research/inbox/example-research-request|example research request]] for the template.

## Topics

- [[research/password-managers/index|Self-hosted password managers]] — comparing Vaultwarden, KeePass, and Bitwarden options

## Inbox

- [[research/inbox/example-research-request|Example research request]] — template

## System

- [[research/journal|Research journal]] — temporal log of what was researched and how the knowledge web evolved
- [[research/research-prompt|Research prompt]] — the prompt template for new research requests; edit here to change output style
- [[research/amend-prompt|Amend prompt]] — the prompt template for `[!claude]` inline amendment tasks; edit here to change how callouts are handled
