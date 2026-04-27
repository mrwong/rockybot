# rockybot

An autonomous research assistant that lives in your Obsidian vault. You drop a research request into an inbox folder; rockybot uses Claude to research the topic, writes multi-page notes back into your vault, and keeps them up to date as your thinking evolves.

```
You write a research request → research/inbox/my-topic.md
                                        │
                               rockybot polls every 10 min
                                        │
                               Claude researches the topic
                                        │
                           research/my-topic/     ← appears in Obsidian
                             index.md
                             options-comparison.md
                             tradeoffs.md
                             ...
```

---

## Features

| Watcher | How to trigger | What it does |
|---|---|---|
| **Inbox** | Drop a `.md` file in `research/inbox/` with `status: pending` | Full multi-page research on a new topic |
| **Amend** (`[!claude]`) | Add a `> [!claude]` callout to any research page | Targeted inline edit: expand a section, add wikilinks, update pricing, reformat |
| **Expand** (`[!expand]`) | Add a `> [!expand]` callout with a brief | Creates a new sub-page and replaces the callout with a wikilink |
| **Revise** (`[!revise]`) | Add a `> [!revise]` callout to a topic's `index.md` | Revises all linked sub-pages to reflect a new decision or changed context |
| **Lint** | Set `status: pending` in `research/lint-trigger.md` | Audits the full wiki for orphaned pages and broken wikilinks; writes a report |

---

## Prerequisites

- **Docker** (with Docker Compose v2)
- An **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com/)
- An **Obsidian vault** that rockybot can read from and write to

### How the vault gets to rockybot

rockybot is a Docker container. It needs a local directory path to read and write `.md` files. How you get your Obsidian vault to that path depends on your setup:

**Running on the same machine as Obsidian** (simplest): mount Obsidian's local vault folder directly. No sync service needed.

**Running on a server**: you need a way to sync your Obsidian vault to the server. The supported option is [**Obsidian Sync**](https://obsidian.md/sync) (Obsidian's first-party paid sync service, ~$10/month). rockybot ships a headless Obsidian container that handles this. See [docs/OBSIDIAN_SETUP.md](docs/OBSIDIAN_SETUP.md) for why self-hosted sync alternatives (like LiveSync) don't work reliably here.

---

## Quick start

### Option A — run on the same machine as Obsidian

If Obsidian is already running on the machine where you'll run the Docker container, you can mount the vault folder directly. No sync service required.

```bash
# 1. Get the config template — it has all available options with comments
curl -o .env https://raw.githubusercontent.com/mrwong/rockybot/main/.env.example

# 2. Open .env in your editor and set your API key:
#    ANTHROPIC_API_KEY=sk-ant-...
#    (all other values have working defaults)

# 3. Run the bot, pointing it at your vault directory
docker run -d \
  --name rockybot \
  --restart unless-stopped \
  --env-file .env \
  -v "/path/to/your/obsidian/vault:/vault" \
  ghcr.io/mrwong/rockybot:latest
```

Replace `/path/to/your/obsidian/vault` with the actual path. On macOS it's usually `~/Documents/Obsidian Vault/<vault-name>`.

On first start, rockybot seeds a `research/` folder and task templates into your vault. Open Obsidian — you'll see them appear.

### Option B — full server stack (bot + Obsidian Sync + static site)

If rockybot runs on a remote server, use `docker-compose.yml` to start all four services together. Requires an Obsidian Sync subscription.

```bash
git clone https://github.com/mrwong/rockybot.git
cd rockybot

# .env.example has all options with descriptions — copy and fill it in
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY at minimum

docker compose up -d
```

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the full walkthrough, including first-time Obsidian Sync setup.

---

## How it works

```
Obsidian (your devices)
    │  Obsidian Sync  ← or direct mount if running locally
    ▼
vault directory  ←──────────────────────────────┐
    │                                            │
    │  rockybot polls every 10 min               │
    ▼                                            │
inbox-watcher / amend-watcher / ...              │
    │                                            │
    │  runs:  claude --print <prompt>            │
    ▼                                            │
Claude CLI ──── reads vault, writes .md files ───┘
    │
    └─ Discord / WhatsApp notification (optional)
```

All five watchers run serialized behind a single mutex — only one Claude invocation at a time. Budget caps prevent runaway API spend.

---

## Configuration

All configuration is via environment variables. `.env.example` in the repo lists every variable with a description and its default. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full reference.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Pay-per-use API key. |
| `VAULT_PATH` | `/vault` | Path inside the container where the vault is mounted. |
| `CLAUDE_SUBSCRIPTION_MODE` | `false` | Use Claude Pro/Max subscription first, fall back to API key. |
| `RESEARCH_BUDGET_USD` | `2.00` | Spend cap per research request. |
| `INBOX_POLL_SECONDS` | `600` | How often to check the vault (seconds). |

---

## Docs

- [Installation](docs/INSTALLATION.md) — detailed setup, billing modes, first-run walkthrough
- [Workflow](docs/WORKFLOW.md) — how to write requests, callout syntax, status machine, troubleshooting
- [Configuration](docs/CONFIGURATION.md) — all env vars with defaults
- [Notifications](docs/NOTIFICATIONS.md) — Discord webhook and Twilio WhatsApp setup
- [Obsidian Setup](docs/OBSIDIAN_SETUP.md) — Templater plugin setup, headless Sync setup, why LiveSync doesn't work
- [Development](docs/DEVELOPMENT.md) — adding watchers, callout detection rules, testing

---

## License

MIT
