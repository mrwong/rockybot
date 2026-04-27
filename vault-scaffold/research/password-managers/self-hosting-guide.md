---
tags: [research, passwords, docker, self-hosting, setup]
created: 2026-01-15
related: ["[[research/password-managers/index]]", "[[research/password-managers/tradeoffs]]"]
sources:
  - url: https://github.com/dani-garcia/vaultwarden/wiki/Using-Docker-Compose
    title: "Vaultwarden Docker Compose wiki"
  - url: https://github.com/dani-garcia/vaultwarden/wiki/Enabling-HTTPS
    title: "Vaultwarden: Enabling HTTPS"
---

# Vaultwarden Self-Hosting Guide

## Prerequisites

- Docker and Docker Compose
- A domain name with DNS control (for TLS)
- A reverse proxy (Traefik, Caddy, or nginx) — Vaultwarden requires HTTPS

## Docker Compose setup

Create `docker-compose.yml`:

```yaml
services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    restart: unless-stopped
    environment:
      - DOMAIN=https://vault.your-domain.example.com
      - SIGNUPS_ALLOWED=false       # disable after creating accounts
      - ADMIN_TOKEN=${ADMIN_TOKEN}  # set a strong random string
    volumes:
      - ./data:/data
```

Create `.env`:
```
ADMIN_TOKEN=<output of: openssl rand -base64 48>
```

## TLS with Caddy (simplest option)

```
vault.your-domain.example.com {
    reverse_proxy vaultwarden:80
}
```

Caddy handles Let's Encrypt automatically. No other config needed.

## First-run setup

1. Start the stack: `docker compose up -d`
2. Navigate to `https://vault.your-domain.example.com/admin` and log in with your `ADMIN_TOKEN`
3. Create user accounts for family members via the admin panel
4. Set `SIGNUPS_ALLOWED=false` in the environment and restart — this prevents new self-registrations
5. Each family member installs the [Bitwarden browser extension](https://bitwarden.com/download/) and mobile app, then points it at your server URL

## Data directory structure

```
./data/
├── db.sqlite3        # the entire vault database
├── attachments/      # file attachments (if any)
├── sends/            # Bitwarden Send files
└── config.json       # instance configuration
```

## Backup

The entire vault is in `db.sqlite3`. Back it up:

```bash
# Daily backup to a local archive
sqlite3 ./data/db.sqlite3 ".backup './backups/vault-$(date +%Y%m%d).sqlite3'"

# Sync backups offsite (e.g., to an S3-compatible store)
rclone sync ./backups remote:vaultwarden-backups
```

See [[research/password-managers/tradeoffs|tradeoffs]] for the full backup strategy, including offsite and disaster recovery.

## Migration from browser-saved passwords

Bitwarden supports CSV imports from Chrome, Firefox, Safari, LastPass, 1Password, and Dashlane. Each family member:

1. Exports passwords from their browser (`chrome://settings/passwords` → Export)
2. Logs in to the Bitwarden web vault at your domain
3. Goes to **Tools → Import data**, selects Chrome CSV format, uploads the file
4. Verifies the import, then deletes passwords from the browser's built-in manager
