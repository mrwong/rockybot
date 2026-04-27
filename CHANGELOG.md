# Changelog

All notable changes to rockybot are documented here. Version numbers follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Documentation-only changes do not increment the version.

## [1.0.0] — 2026-04-17

Initial public release extracted from boughtmyowncloud.

### Added
- Inbox watcher: drop a request into `research/inbox/`, Claude writes a multi-page wiki tree
- Amend watcher: `[!claude]` callout for targeted inline edits
- Expand watcher: `[!expand]` callout to create sub-pages
- Revise watcher: `[!revise]` callout for corpus-level rewrites across a topic's sub-pages
- Lint watcher: audit the full research wiki for orphaned pages and broken wikilinks
- Claude subscription billing mode with API key fallback
- Discord and Twilio WhatsApp notifications
- Obsidian Sync integration via headless container
- Quartz static site builder via obsidian-bridge container
- GitHub Actions CI: unit tests, integration tests, Docker image publish to GHCR
