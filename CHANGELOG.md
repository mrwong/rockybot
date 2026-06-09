# Changelog

All notable changes to rockybot are documented here. Version numbers follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Documentation-only changes do not increment the version.

## [1.6.0] — 2026-06-08

### Changed

- **Prompt scaffolds now sync to the vault on bot restart.** The seeder previously only seeded prompt files when missing (the "create if missing" policy), so any scaffold changes shipped in a new bot image silently never reached existing deployments — a real footgun, and the root cause of the v1.5.0 outbox-first behavior failing to take effect. The new policy: `*-prompt.md` files are bot-controlled. On every startup the seeder compares live vs scaffold; if they differ, the live copy is moved to `research/.prompts-backup/<name>-YYYYMMDD-HHMMSS.md` and the scaffold version takes its place. User-owned files (`research/index.md`, topic folders, journal) keep the old "create if missing" behavior — nothing the user writes is ever overwritten. Each prompt scaffold now carries an `> [!info]` callout in Obsidian explaining the policy and pointing at the backup path.
- **Scaffold prompts brought into agreement with the v1.5.0 outbox-first design.** `vault-scaffold/research/research-prompt.md` Step 4 now writes to `research/outbox/<topic-slug>/`, Step 5 (index update + Karpathy backlinks) is deferred to filing time, and the Step 6 journal entry points at the outbox path. The relink watcher rewrites these when the user files the outbox folder into a PARA bucket.
- **Documentation updates.** `docs/WORKFLOW.md` "Editable prompts" section rewritten to explain the sync policy and how to make permanent prompt changes; `docs/INSTALLATION.md` "Updating" note corrected (was claiming nothing is ever overwritten, which is no longer true for prompts).

## [1.5.0] — 2026-06-06

### Changed

- **Research output always lands in `research/outbox/<topic-slug>/`.** Previously the inbox watcher's prompt asked Claude to file each new topic into a PARA bucket directly. In practice this meant hunting for where research ended up after commissioning it. Claude now writes every completed topic to `research/outbox/` so the user can triage and file it (drag-drop into `projects/`, `areas/`, `resources/`, or `archive/`) at their own pace. The relink watcher already covers the wikilink repair on the move out of outbox, so the journal entry, prose references, and `para:` frontmatter all converge once the topic lands in its permanent home.

- **Research prompt no longer touches `research/index.md` or backlinks existing pages on first write.** Both depend on the topic's final location, which the outbox-first workflow defers to filing time. The journal entry is still written immediately (and gets its wikilink rewritten by the relink watcher when the topic moves out of outbox).

- **Relink watcher defaults to `haiku` instead of `sonnet`.** Now that the relink watcher fires on every outbox → PARA move, its work is mechanical enough (prose tweaks, `[[wikilink]]` rewrites, frontmatter dates) that haiku handles it cleanly. Sonnet remains available via `RELINK_MODEL=sonnet`. Per-move cost drops from ~$0.05 to ~$0.005.

## [1.4.0] — 2026-06-06

### Added

- **Relink watcher.** Automatically detects when topic folders have been moved in Obsidian and repairs what Obsidian's link resolver cannot: prose references to old location names and stale `para:`/`updated:` frontmatter fields. Runs on every poll cycle with zero Claude cost when nothing has moved — the watcher computes a diff between a stored shape manifest (`research/wiki-shape.json`) and the current vault structure using pure JS. Claude is invoked only when moves are detected, and only reads the files that actually reference the moved topics, keeping per-session cost to $0.01–$0.10. After Claude runs, the manifest is updated so the next poll starts fresh. Configurable via `RELINK_BUDGET_USD` (default `$2.00`) and `RELINK_MODEL` (default `sonnet`). The prompt template lives in `research/relink-prompt.md` in the vault — edit it in Obsidian to change repair behavior without redeploying.

## [1.3.0] — 2026-06-06

### Added

- **`[!consolidate]` watcher.** Place a `> [!consolidate]` callout in any research topic's `index.md` to merge one or more source topics into that target topic. The watcher reads the instruction text from the callout, merges source content into the target, updates all wikilinks across the vault pointing to the source, moves the source folder to `research/archive/`, and removes the callout when done. Configurable via `CONSOLIDATE_BUDGET_USD` (default `$4.00`) and `CONSOLIDATE_MODEL` (default `sonnet`). The prompt template lives in `research/consolidate-prompt.md` in the vault — edit it in Obsidian to change merge behavior without redeploying.

- **`!research help` command.** New Discord text command that lists all available `!research` commands with one-line descriptions. Requires `DISCORD_INTERACTIVE_AUTH=true` and Message Content Intent.

- **Enhanced `!research status`.** The status command now shows three additional lines alongside hold/gate state:
  - **Watcher busy indicator** — `🔄 Watcher: running` when a Claude invocation is in progress, `⚙️ Watcher: idle` otherwise.
  - **Next run countdown** — `⏱ Next run: in Xm Ys` showing time until the next scheduled poll.
  - **▶️ Run now button** — interactive button that cancels the current interval and fires a poll immediately, then resets the interval from that point. Useful for testing a new research request without waiting for the next scheduled tick.

## [1.2.0] — 2026-05-02

### Added

- **Quiet hours gate.** Set `RESEARCH_QUIET_HOURS="HH:MM-HH:MM"` (UTC) to suppress inbox research during a time window — e.g. `09:00-18:00` to keep the subscription quota free for interactive Claude Code sessions during the work day. Midnight-spanning windows are supported (`22:00-06:00`). When a new item arrives during quiet hours, the bot sends a per-item Discord notification with an **▶️ Run now** button so you can promote individual items without lifting the gate for everything.

- **Per-item expedite.** Clicking the "Run now" button on a quiet-hours notification marks that specific item `status: expedited` in its frontmatter. Expedited items always run on the next poll regardless of quiet hours, hold, or pacing state — other queued items stay back. The button triggers an immediate poll so the item runs within seconds, not at the next poll interval.

- **Request pacing.** Set `RESEARCH_MIN_INTERVAL_MINUTES=N` to enforce a minimum gap between consecutive research task completions. Prevents quota bursts when several items are queued at once; each completion resets the timer.

- **Discord hold toggle.** Three new text commands available in your bot channel when `DISCORD_INTERACTIVE_AUTH=true`:
  - `!research hold` — pauses all inbox research (silent; other watchers keep running)
  - `!research release` — resumes inbox research
  - `!research status` — reports hold state and current gate reason

  Hold state is persisted to `research/.research-hold` in the vault, so it survives bot restarts. If the bot starts with hold active it logs a warning. Requires **Message Content Intent** enabled in the Discord developer portal.

- **New `expedited` frontmatter status.** Items marked `status: expedited` in `research/inbox/` are processed immediately regardless of gate state, then follow the normal completed/awaiting-input/error flow.

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
