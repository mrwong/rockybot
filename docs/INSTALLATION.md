# Installation

## Prerequisites

- **Docker** and **Docker Compose** (v2)
- An **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com/) (or a Claude Pro/Max subscription; see [billing modes](#billing-modes))
- An **Obsidian vault directory** that rockybot can read and write

## Quick start (bot only)

The simplest setup runs just the research bot against a vault directory you already manage. You don't need the full Obsidian sync stack.

**1. Create a working directory and copy the example config:**

```bash
mkdir rockybot && cd rockybot
curl -o .env https://raw.githubusercontent.com/mrwong/rockybot/main/.env.example
```

**2. Edit `.env`** and set at minimum:

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
VAULT_PATH=/vault
```

**3. Run the bot:**

```bash
docker run -d \
  --name rockybot \
  --restart unless-stopped \
  --env-file .env \
  -v /path/to/your/obsidian/vault:/vault \
  ghcr.io/mrwong/rockybot:latest
```

On first start, rockybot seeds the `research/` folder and Obsidian templates into your vault (existing files are never overwritten). It then begins polling every 10 minutes.

**Check logs:**
```bash
docker logs -f rockybot
```

## Full stack (bot + Obsidian sync + static site)

If you want the complete stack — Obsidian Sync daemon, Quartz static site builder, and nginx notes site — use the provided `docker-compose.yml`:

```bash
git clone https://github.com/mrwong/rockybot.git
cd rockybot
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

This starts four services:
- `rockybot` — the research bot
- `rockybot-headless` — Obsidian Sync daemon (requires one-time interactive setup; see [OBSIDIAN_SETUP.md](OBSIDIAN_SETUP.md))
- `rockybot-bridge` — Quartz site builder
- `rockybot-notes` — nginx serving the built site at `http://localhost:8080`

## Billing modes

rockybot can call Claude two ways:

**API key (default):** Set `ANTHROPIC_API_KEY` and leave `CLAUDE_SUBSCRIPTION_MODE=false`. Each watcher invocation is billed per-token against your API key. Budget caps (`RESEARCH_BUDGET_USD`, etc.) prevent runaway spend.

**Claude subscription (opt-in):** If you have Claude Pro or Max, you can use your subscription session instead of the API key, falling back to the API key if you hit rate limits or your session expires.

To enable subscription mode:
1. Run `claude login` on your Docker host to create a session in `~/.claude/`
2. Mount that directory into the container and set `CLAUDE_SUBSCRIPTION_MODE=true`:

```yaml
bot:
  image: ghcr.io/mrwong/rockybot:latest
  environment:
    - CLAUDE_SUBSCRIPTION_MODE=true
    - ANTHROPIC_API_KEY=sk-ant-...  # fallback only
  volumes:
    - ~/.claude:/home/ubuntu/.claude
    - /path/to/vault:/vault
```

If the subscription session expires, rockybot sends a Discord notification (if configured) and automatically retries using the API key.

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

Open your vault in Obsidian — you'll see a new `research/` folder with prompt templates and an example, plus Obsidian templates in `templates/`.

## Updating

```bash
docker pull ghcr.io/mrwong/rockybot:latest
docker compose up -d
```

Or with docker run: stop, remove, and re-run with the same flags.
