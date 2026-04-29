# Changelog

All notable changes to rockybot are documented here. Version numbers follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Documentation-only changes do not increment the version.

## [Unreleased]

### Added
- Topic export: published topics now have a "⬇ Export ZIP" link on the notes-web root index. Clicking it generates and downloads a self-contained HTML ZIP (topic pages + Quartz CSS/JS assets) that works offline. Cross-topic links are neutered with a tooltip. Export is on-demand via an HTTP server in the bridge container proxied through nginx; slug validation and publish-list whitelist (read fresh on every request) prevent path traversal and access to unpublished topics.

## [1.0.1] — 2026-04-28

### Fixed
- Claude auth silent failure when `HOME=/home/ubuntu` is set: the `node:20-alpine` base image runs as uid 1000 (`node`) but `/home/ubuntu` was owned by root, so Claude Code couldn't create lock files or write config updates. Both subscription billing and API key fallback would silently exit 0 with no output after a 30 s remote-settings timeout. Fix: create `/home/ubuntu` with `node:node` ownership in the Dockerfile.

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
