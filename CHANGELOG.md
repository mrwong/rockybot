# Changelog

All notable changes to rockybot are documented here. Version numbers follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Documentation-only changes do not increment the version.

## [Unreleased]

### Added
- Topic export: published topics now have a "⬇ Export ZIP" link on the notes-web root index. Clicking it generates and downloads a self-contained HTML ZIP (topic pages + Quartz CSS/JS assets) that works offline. Cross-topic links are neutered with a tooltip. Export is on-demand via an HTTP server in the bridge container (port 3001) proxied through nginx; slug format gate, publish-list whitelist (read fresh per request), Quartz output existence check, and a per-topic concurrency guard (429) prevent misuse.
- Integration test suite (49 tests) covering `getPublishedTopics`, `rewriteHtml`/`buildTopicExport` (ZIP structure and HTML rewriting), and the HTTP export server (routing, slug format gate, publish whitelist, 503 on missing Quartz output, 429 concurrency guard). Run locally with `npm run test:integration:docker` — no host Node.js required.

### Fixed
- notes-web: clicking a topic folder in the Explorer sidebar now navigates to the topic index page instead of only toggling expand/collapse. Fix: bridge startup patches `quartz.layout.ts` to set `folderClickBehavior: "link"`.
- notes-web: vault-absolute wikilinks containing the `research/` URL prefix (e.g. `/research/my-topic/page`) now resolve correctly instead of returning 404. Fix: nginx rewrites `/research/*` → `/*`.
- Export: in-progress lock was never released on client disconnect, permanently blocking re-export of that topic until the bridge restarted. Fix: `req.on('close')` clears the lock immediately on disconnect.

## [1.0.1] — 2026-04-28

### Fixed
- Claude auth silent failure when `HOME=/home/ubuntu` is set: the `node:20-alpine` base image runs as uid 1000 (`node`) but `/home/ubuntu` was owned by root, so Claude Code couldn't create lock files or write config updates. Both subscription billing and API key fallback would silently exit 0 with no output after a 30 s remote-settings timeout. Fix: create `/home/ubuntu` with `node:node` ownership in the Dockerfile.

## [1.0.0] — 2026-04-17

Initial public release extracted from a private homelab monorepo.

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
