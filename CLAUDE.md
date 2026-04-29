# rockybot — project notes for Claude

## Project Overview

rockybot is a self-hosted autonomous research assistant. It watches an Obsidian vault and spawns Claude Code CLI (`--print` mode) for five kinds of research tasks. Three Docker services make up the stack:

| Service | Image | Role |
|---|---|---|
| `rockybot` | `ghcr.io/mrwong/rockybot` | Core bot — polls vault, runs all watchers |
| `rockybot-bridge` | `ghcr.io/mrwong/rockybot-bridge` | Watches vault for changes, rebuilds Quartz static site |
| `rockybot-headless` | `ghcr.io/mrwong/rockybot-headless` | Obsidian Sync daemon (remote deployments only) |

The bot is deployed in the homelab via `~/src/boughtmyowncloud` — that repo owns the `docker-compose.yml` entry, secrets injection, and GitOps pipeline. To redeploy after changing rockybot code: push a release tag here (triggers GHCR image publish), then push to `main` in boughtmyowncloud (triggers GitOps sync).

## Repository Layout

```
services/
  bot/
    src/
      index.js            — main poll loop (global mutex, runs all watchers sequentially)
      *-watcher.js        — five watcher modules (see below)
      claude-runner.js    — spawns `claude --print` subprocess; Pro → API key fallback
      notifier.js         — Discord webhook + Twilio WhatsApp alerts
      seeder.js           — seeds vault with scaffold files on first boot
    package.json          — canonical version source
  obsidian-bridge/        — chokidar watcher → Quartz rebuild
  obsidian-headless/      — `ob sync` daemon
vault-scaffold/           — default vault files baked into bot Docker image
templates/                — Obsidian templates seeded to vault on startup
tests/
  unit/                   — fast, no Claude required
  integration/            — spawns real Claude; use sparingly
scripts/
  release.sh              — semver bump + CHANGELOG + tag
docs/                     — INSTALLATION, WORKFLOW, CONFIGURATION, DEVELOPMENT guides
docker-compose.yml        — production stack
docker-compose.dev.yml    — dev stack (single container, temp vault, haiku models, $0.10 caps)
```

## The Five Watchers

All watchers follow the same pattern: scan vault → detect trigger → run `claude --print` with a prompt → update vault.

| Watcher | Trigger | What Claude does | Default budget | Default model |
|---|---|---|---|---|
| **inbox** | `research/inbox/*.md` with `status: pending` | Full multi-page research, writes topic dir, updates `research/index.md`, Karpathy backlink pass | `$2.00` | `sonnet` |
| **amend** | `> [!claude]` callout in any page | Targeted inline edit per callout instruction | `$0.50` | `haiku` |
| **expand** | `> [!expand]` callout | Creates new sub-page on callout topic, replaces callout with wikilink | `$1.00` | `sonnet` |
| **revise** | `> [!revise]` callout in topic `index.md` | Corpus-level rewrite — finds all wikilinked sub-pages, revises each in-place | `$4.00` | `sonnet` |
| **lint** | `status: pending` in `research/lint-trigger.md` | Full wiki audit: orphaned pages, broken wikilinks, writes `lint-report.md` | `$5.00` | `sonnet` |

Budgets and models are all overridable via env vars (`INBOX_BUDGET_USD`, `AMEND_MODEL`, etc.). See `docs/CONFIGURATION.md`.

## Key Architecture Notes

- `index.js` holds a **global mutex** — only one Claude subprocess runs at a time across all watchers.
- `claude-runner.js` tries the Claude subscription first; falls back to `ANTHROPIC_API_KEY` if auth fails.
- Prompt files live in the vault (`research/*-prompt.md`) — user-editable, with hardcoded fallbacks if missing.
- The dev compose file (`docker-compose.dev.yml`) live-mounts `services/bot/src` so source changes take effect without rebuilding.
- Bot container mounts `~/.claude:/home/node/.claude` for Pro subscription billing auth.

## Development Workflow

```bash
# Run unit tests (no Claude required)
npm test

# Run integration tests (spawns real Claude — costs money)
npm run test:integration

# Start dev stack (isolated vault, haiku models, $0.10 caps)
docker compose -f docker-compose.dev.yml up

# Add a new watcher: follow the pattern in any existing *-watcher.js,
# register it in index.js, add budget/model env vars to .env.example,
# update docs/CONFIGURATION.md and docs/WORKFLOW.md
```

## Versioning policy

rockybot uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| **major** | Breaking changes: removed or renamed env vars, incompatible config format changes, removed features |
| **minor** | New functionality: new watchers, new callout types, new env vars, new integrations |
| **patch** | Bug fixes, internal refactors, test improvements, CI changes, dependency updates |
| *(none)* | Documentation changes only (`docs:` commits, `.md` file edits) |

Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes in commit messages. The release script uses these to categorize and propose the right bump level:

- `feat:` → minor (or `feat!:` for major)
- `fix:` → patch (or `fix!:` for major)
- `refactor:`, `perf:` → patch, shown as "Changed"
- `test:`, `chore:` → patch, shown as "Internal"
- `docs:` → no version bump

## Releasing

```bash
./scripts/release.sh
```

The script:
1. Fetches latest tags from origin
2. Shows all commits since the last tag, grouped by type
3. Proposes a bump level based on commit prefixes
4. You confirm or type `major` / `minor` / `patch` to override
5. Confirms before making any changes
6. Writes a CHANGELOG.md entry, bumps `services/bot/package.json` and `services/obsidian-bridge/package.json`, commits as `chore: release vX.Y.Z`, and creates the git tag
7. Asks whether to push to origin (pushing the tag triggers GitHub Actions to publish Docker images)

**Never bump the version manually** — always go through `./scripts/release.sh` so the CHANGELOG stays in sync.

## What lives where

| Canonical version | `services/bot/package.json` |
|---|---|
| Kept in sync | `services/obsidian-bridge/package.json` |
| Release history | `CHANGELOG.md` |
| Docker image tags | Driven by git tags via GitHub Actions |

## Tests

Every bug fix and new feature must include tests. See `docs/DEVELOPMENT.md` for how to run them.
