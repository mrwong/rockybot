---
tags: [research, passwords, security, backup, tradeoffs]
created: 2026-01-15
related: ["[[research/password-managers/index]]", "[[research/password-managers/options-comparison]]", "[[research/password-managers/self-hosting-guide]]"]
sources:
  - url: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
    title: "OWASP Password Storage Cheat Sheet"
  - url: https://www.rclone.org/
    title: "rclone — sync files to cloud storage"
---

# Tradeoffs: Self-hosted Password Management

## Security model

### What self-hosting buys you

- Credentials never transit a third-party server (except for sync)
- You control the encryption keys (Vaultwarden uses the same Bitwarden encryption: AES-256 CBC with PBKDF2-SHA256 or Argon2id key derivation)
- No vendor lock-in; the `.sqlite3` database is portable

### What self-hosting costs you

- **You are now the ops team.** Server downtime = no password access. Disk failure without backup = vault loss.
- Vaultwarden has not been independently audited (the Bitwarden protocol has, but not this implementation specifically)
- If your server is internet-facing, you're responsible for keeping it patched

### Risk comparison

| Risk | Third-party (1Password, Bitwarden cloud) | Self-hosted (Vaultwarden) |
|------|---|---|
| Vendor breach | Yes (though encrypted) | No |
| Data loss | Vendor's problem | Your problem |
| Availability | 99.9%+ SLA | Depends on your uptime |
| Audit status | High (regular audits) | Medium (protocol audited, server not) |

**For most households:** the vendor breach risk is lower than the self-hosting operational risk (backup failures, missed patches). Self-hosting is appropriate if you already run a reliable homelab with automated backups and monitoring.

## Backup strategy

A password vault without backup is a single point of failure. The recommended approach has three layers:

### Layer 1 — Local database backup (automated daily)

```bash
# cron: 0 2 * * * /opt/vaultwarden/backup.sh
sqlite3 /opt/vaultwarden/data/db.sqlite3 ".backup '/opt/vaultwarden/backups/vault-$(date +%Y%m%d).sqlite3'"
find /opt/vaultwarden/backups -name "*.sqlite3" -mtime +30 -delete
```

Keeps 30 days of daily snapshots locally.

### Layer 2 — Offsite backup (automated, separate location)

```bash
# rclone to S3-compatible storage (Backblaze B2, Cloudflare R2, AWS S3)
rclone sync /opt/vaultwarden/backups remote:vaultwarden-backups --min-age 1h
```

The SQLite file is already encrypted at the application layer. Storing it in cloud object storage is safe even without additional encryption-at-rest.

### Layer 3 — Bitwarden export (quarterly manual)

Export from the Bitwarden web vault (**Tools → Export vault**) as an encrypted JSON. Store this in a separate secure location (e.g., a USB drive in a fireproof safe). This is your recovery path if the server and backups are both lost.

## Availability and family UX

If your server goes down (maintenance, power outage), the Bitwarden mobile and desktop clients cache the vault locally — users can still read credentials, they just can't sync new ones until the server is back.

For mobile-only users who don't sync often, this is usually fine. For browser extension users who rely on autofill for new logins, a server outage means a degraded experience.

**Mitigation:** Use a monitoring service (UptimeRobot free tier) to alert you immediately when Vaultwarden goes down.

## Migration path away from self-hosting

If you later decide to move to a managed service:

1. Export from Vaultwarden web vault → **Tools → Export vault → JSON (encrypted)**
2. Import to Bitwarden.com, 1Password, or Dashlane — all accept Bitwarden-format exports
3. Ask family members to re-link their apps to the new server URL

The migration is low-friction because Vaultwarden uses the standard Bitwarden data format.
