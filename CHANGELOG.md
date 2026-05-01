# Changelog

All notable changes to rockybot are documented here. Version numbers follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Documentation-only changes do not increment the version.

## [1.1.1] — 2026-04-30

### Fixed

- **Subscription usage limit now notifies Discord and holds instead of silently falling back.** Previously, hitting the Claude Pro/Max daily usage limit caused the bot to silently switch to API key billing without any notification. Root cause: Claude CLI emits "You've hit your limit · resets 7am (UTC)" on **stdout** (not stderr), so the error classifier missed it entirely and routed the failure to the auth handler, which then failed trying to run an OAuth login flow against a rate-limit error.

  New behavior when `CLAUDE_SUBSCRIPTION_MODE=true` and the usage limit is hit:

  - **Interactive mode** (`DISCORD_INTERACTIVE_AUTH=true`): posts a Discord message with two buttons — **⏳ Wait for reset** and **💰 Use API Key**. Bot holds the mutex until the user responds. Clicking "Wait" causes the bot to sleep until the parsed reset time (e.g. "7am UTC"), then automatically retry subscription billing. Clicking "Use API Key" falls back to paid billing immediately.
  - **Webhook-only mode**: posts a Discord embed and auto-waits for the reset time without requiring user input.
  - **24h hard cap**: if still rate-limited after 24 hours, posts another notification and falls back to the API key.
  - Reset time is parsed directly from the CLI error message ("resets 7am (UTC)") so the bot sleeps to the exact reset moment.

## [1.1.0] — 2026-04-29

### Added

- **Topic export.** Published topics now have a "⬇ Export ZIP" link on the notes-web root index. Clicking it streams a self-contained ZIP containing all rendered HTML pages for the topic plus the Quartz CSS, JS, and font assets — fully usable offline. Cross-topic links are neutered and shown as plain text with a tooltip. The export server lives in the bridge container on port 3001, proxied through nginx. Security gates applied in order: slug format check (`[a-z0-9-]+` only), publish-list whitelist (re-read from vault on every request — unpublishing a topic blocks exports immediately), Quartz output existence check (503 if not yet built), and a per-topic concurrency guard (429 if already in progress).

- **Interactive Discord auth.** When `CLAUDE_SUBSCRIPTION_MODE=true` and subscription auth fails, the bot now pauses the failing task and posts a clickable OAuth button to Discord instead of immediately falling back to the API key. Completing the login from a phone or browser resumes the task under subscription billing. Configure with `DISCORD_INTERACTIVE_AUTH=true`, `DISCORD_BOT_TOKEN`, and `DISCORD_CHANNEL_ID`. A configurable timeout (`DISCORD_AUTH_TIMEOUT_MINUTES`, default 5) triggers automatic API key fallback if no one responds.

- **Version endpoint.** `GET /version` on the bridge (proxied at `https://notes.yourdomain/version`) returns `{"version":"x.y.z"}` baked from the image's `package.json`. Useful for verifying which image version is live after a deploy before smoke-testing.

- **Integration test suite** (50 tests, no Claude API key required). Covers the three major surface areas of obsidian-bridge: `getPublishedTopics` vault scanning and publish-flag filtering; `rewriteHtml`/`buildTopicExport` HTML rewriting and ZIP structure; and the HTTP export server's routing, slug format gate, publish whitelist, 503/429 guards, and `/version` endpoint. Run with `npm run test:integration:docker` — uses a pre-baked Docker image so no host Node.js install is needed.

### Fixed

- **notes-web: Explorer navigation.** Clicking a topic folder in the sidebar now navigates to the topic's index page instead of only toggling the expand/collapse state. Fix: bridge startup patches `quartz.layout.ts` at runtime to set `folderClickBehavior: "link"`.

- **notes-web: `/research/` 404s.** Vault notes use vault-absolute wikilinks that include a `research/` prefix in the rendered URL (e.g. `/research/my-topic/sub-page`). These returned 404 because the Quartz output tree doesn't include that prefix. Fix: nginx rewrites `/research/*` → `/*` before serving.

- **Export: lock held after client disconnect.** If a browser navigated away or timed out mid-download, the in-progress lock for that topic was never released, blocking all further exports until the bridge restarted. Fix: `req.on('close')` clears the lock immediately on disconnect.

- **Notifications: Discord webhook redirects.** Discord webhooks occasionally return a redirect. The `curl` call was not following redirects, silently dropping notifications. Fix: added `-L` flag.

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
