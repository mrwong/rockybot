# Installation

## Prerequisites

### Required

- **Docker** and **Docker Compose** (v2 — the `docker compose` subcommand, not the old `docker-compose` binary)
- An **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com/). Alternatively, if you have a Claude Pro or Max subscription, you can use that instead; see [Billing modes](#billing-modes) below.
- An **Obsidian vault** with a local directory path that Docker can mount

### How the vault gets to the server

rockybot reads from and writes to a directory mounted into its container. How that directory gets populated with your Obsidian notes depends on where you're running the bot:

**Same machine as Obsidian (simplest):** Mount Obsidian's local storage folder directly. Obsidian keeps a local copy of your vault that you can point Docker at — no sync service needed. Skip to [Quick start (bot only)](#quick-start-bot-only).

**Remote server:** Your vault exists on your laptop in Obsidian; you want the bot to run on a Linux server. You need a sync mechanism to get the vault directory onto the server. The supported option is **[Obsidian Sync](https://obsidian.md/sync)** — Obsidian's first-party subscription service (~$10/month or $96/year). rockybot ships an `obsidian-headless` container that runs a real headless Obsidian process and handles sync automatically. See [Full stack setup](#full-stack-bot--obsidian-sync--static-site) and [OBSIDIAN_SETUP.md](OBSIDIAN_SETUP.md) for why self-hosted alternatives like LiveSync don't work reliably here.

---

## Quick start (bot only)

Use this if rockybot runs on the same machine as your Obsidian installation, or if you already have the vault directory available at a local path.

**1. Get the config template:**

```bash
mkdir rockybot && cd rockybot
curl -o .env https://raw.githubusercontent.com/mrwong/rockybot/main/.env.example
```

`.env.example` is downloaded directly as `.env`. It lists every available config option with descriptions and working defaults — open it in a text editor before continuing.

**2. Edit `.env`** and set at minimum:

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Everything else has a sensible default. `VAULT_PATH` defaults to `/vault`, which matches the volume mount in the next step — leave it as-is.

**3. Find your vault directory path.**

Obsidian stores vaults at the location you chose when creating the vault. Common defaults:

| OS | Default location |
|---|---|
| macOS | `~/Documents/Obsidian Vault/<vault-name>` |
| Windows | `C:\Users\<you>\Documents\Obsidian Vault\<vault-name>` |
| Linux | `~/Documents/<vault-name>` |

Check **Obsidian → Settings → About** — it shows the vault path.

**4. Run the bot:**

```bash
docker run -d \
  --name rockybot \
  --restart unless-stopped \
  --env-file .env \
  -v "/path/to/your/obsidian/vault:/vault" \
  ghcr.io/mrwong/rockybot:latest
```

Replace `/path/to/your/obsidian/vault` with the path from step 3.

**5. Check the logs:**

```bash
docker logs -f rockybot
```

You should see seeding output followed by "inbox: no pending requests found". Open your vault in Obsidian — a `research/` folder will have appeared.

---

## Full stack (bot + Obsidian sync + static site)

Use this when rockybot runs on a server separate from your devices. Requires an Obsidian Sync subscription.

```bash
git clone https://github.com/mrwong/rockybot.git
cd rockybot

# .env.example documents every option — copy it and fill in your values
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY at minimum

docker compose up -d
```

This starts four services:

| Service | What it does |
|---|---|
| `rockybot` | The research bot |
| `rockybot-headless` | Headless Obsidian instance — handles Obsidian Sync |
| `rockybot-bridge` | Quartz static site builder |
| `rockybot-notes` | nginx serving the built site at `http://localhost:8080` |

`rockybot-headless` requires one-time interactive setup the first time it runs. See [OBSIDIAN_SETUP.md](OBSIDIAN_SETUP.md) for the full walkthrough.

---

## Billing modes

rockybot can call Claude two ways:

**API key (default):** Set `ANTHROPIC_API_KEY` and leave `CLAUDE_SUBSCRIPTION_MODE=false`. Each watcher invocation is billed per-token against your API key. Budget caps (`RESEARCH_BUDGET_USD`, etc.) prevent runaway spend.

**Claude subscription (opt-in):** If you have Claude Pro or Max, you can use your subscription session instead of the API key. The bot falls back to the API key if you hit rate limits or your session expires.

To enable subscription mode:

1. Run `claude login` on your Docker host. This creates an auth session in `~/.claude/`.
2. Mount that directory into the container and set `CLAUDE_SUBSCRIPTION_MODE=true`:

```yaml
# In docker-compose.yml or your own compose file:
bot:
  image: ghcr.io/mrwong/rockybot:latest
  environment:
    - CLAUDE_SUBSCRIPTION_MODE=true
    - ANTHROPIC_API_KEY=sk-ant-...  # fallback only — still required
  volumes:
    - ~/.claude:/home/ubuntu/.claude
    - /path/to/vault:/vault
```

If the subscription session expires, rockybot sends a Discord notification (if configured) and automatically retries using the API key.

> **Note:** Budget caps (`RESEARCH_BUDGET_USD`, etc.) only apply when billing through the API key. Subscription usage is not capped by the bot — your Claude subscription plan's limits apply instead.

---

## First-run experience

After starting, check `docker logs rockybot`. You should see:

```
[INFO] rockybot starting
[INFO] vault: /vault
[INFO] poll interval: every 600s
[INFO] seeder: seeding vault scaffold into /vault
[INFO] seeder: seeded research/research-prompt.md
[INFO] seeder: seeded research/index.md
... (more seeded files)
[INFO] seeder: done
[INFO] --- inbox scan start ---
[INFO] inbox: no pending requests found
[INFO] --- inbox scan end ---
```

Open your vault in Obsidian. You'll see:

- `research/` — prompt templates, a completed example (password managers), and an empty inbox ready for your first request
- `templates/` — Obsidian task templates for creating requests and callouts quickly

See [OBSIDIAN_SETUP.md](OBSIDIAN_SETUP.md) to configure the Obsidian Templates plugin so you can insert these with a single keystroke.

---

## Updating

```bash
docker pull ghcr.io/mrwong/rockybot:latest
docker compose up -d   # or restart your docker run container with the same flags
```

rockybot never overwrites vault files that already exist — seeded prompt templates you've customized are safe.
