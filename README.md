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

## Quick start

**Prerequisites:** Docker, an Obsidian vault directory, an [Anthropic API key](https://console.anthropic.com/).

```bash
# 1. Get the config
curl -o .env https://raw.githubusercontent.com/mrwong/rockybot/main/.env.example

# 2. Set your API key
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" >> .env

# 3. Run the bot against your vault
docker run -d \
  --name rockybot \
  --restart unless-stopped \
  --env-file .env \
  -v /path/to/your/obsidian/vault:/vault \
  ghcr.io/mrwong/rockybot:latest
```

On first start, rockybot seeds a `research/` folder and Obsidian task templates into your vault. Open Obsidian — you'll see them appear.

Full stack (bot + Obsidian Sync daemon + Quartz static site):

```bash
git clone https://github.com/mrwong/rockybot.git
cd rockybot
cp .env.example .env
# Edit .env
docker compose up -d
```

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed setup, billing modes, and first-run walkthrough.

---

## How it works

```
Obsidian (your devices)
    │  Obsidian Sync
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

All configuration is via environment variables. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full reference.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Pay-per-use API key. |
| `VAULT_PATH` | `/vault` | Mount point for the Obsidian vault. |
| `CLAUDE_SUBSCRIPTION_MODE` | `false` | Use Claude Pro/Max subscription first, fall back to API key. |
| `RESEARCH_BUDGET_USD` | `2.00` | Spend cap per research request. |
| `INBOX_POLL_SECONDS` | `600` | How often to check the vault (seconds). |

---

## Docs

- [Installation](docs/INSTALLATION.md) — quick start, full stack, billing modes
- [Workflow](docs/WORKFLOW.md) — how to write requests, callout syntax, status machine, troubleshooting
- [Configuration](docs/CONFIGURATION.md) — all env vars with defaults
- [Notifications](docs/NOTIFICATIONS.md) — Discord webhook and Twilio WhatsApp setup
- [Obsidian Setup](docs/OBSIDIAN_SETUP.md) — Templates plugin, headless Sync setup
- [Development](docs/DEVELOPMENT.md) — adding watchers, callout detection rules, testing

---

## License

MIT
