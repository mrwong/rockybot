---
tags: [research, passwords, security, comparison]
created: 2026-01-15
related: ["[[research/password-managers/index]]", "[[research/password-managers/self-hosting-guide]]"]
sources:
  - url: https://github.com/dani-garcia/vaultwarden
    title: "Vaultwarden GitHub repository"
  - url: https://bitwarden.com/help/install-on-premise-linux/
    title: "Bitwarden self-hosted installation guide"
  - url: https://keepassxc.org/
    title: "KeePassXC — cross-platform KeePass"
---

# Password Manager Options Comparison

## Vaultwarden (recommended)

[Vaultwarden](https://github.com/dani-garcia/vaultwarden) is an unofficial Bitwarden-compatible server written in Rust. It implements the Bitwarden API, so all official Bitwarden clients (browser extensions, iOS, Android, desktop apps) work without modification.

**Pros:**
- Runs on minimal hardware — a single Docker container, under 100MB RAM at idle
- SQLite database by default (simple backup: copy one file)
- All official Bitwarden clients work; UI is polished and familiar
- Actively maintained, large community
- Free (MIT license)

**Cons:**
- Unofficial — not audited by Bitwarden, Inc. (though the codebase is open)
- Some Bitwarden enterprise features (SSO, directory sync) are not implemented
- Requires HTTPS — needs a reverse proxy with TLS (e.g., Traefik, Caddy, nginx)

**Resource requirements:** ~10MB RAM idle, ~50MB peak. Runs on any hardware from a Raspberry Pi upward.

## Official Bitwarden Server

[Bitwarden's self-hosted server](https://bitwarden.com/help/install-on-premise-linux/) is the reference implementation, maintained by Bitwarden, Inc.

**Pros:**
- Officially supported and security-audited
- All features including enterprise SSO, directory sync, admin console

**Cons:**
- Requires SQL Server (or runs its own MSSQL container) — 1–2GB RAM minimum
- Multi-container setup (6+ services) — more moving parts
- Free for households but the resource overhead is hard to justify vs. Vaultwarden

**Verdict:** Only choose this if you need enterprise features or want official support. For household use, Vaultwarden is strictly better.

## KeePass / KeePassXC

[KeePass](https://keepass.info/) stores credentials in an encrypted `.kdbx` file on disk. [KeePassXC](https://keepassxc.org/) is the cross-platform community fork with a better UI.

**Pros:**
- No server required — the `.kdbx` file IS the vault
- Excellent security model — completely offline by default
- Free and open-source
- Works on Windows, macOS, Linux; KeePass2Android and Strongbox on mobile

**Cons:**
- **Sync is your problem** — you need Syncthing, Nextcloud, or a cloud drive to share across devices and family members
- Mobile UX is good but requires more setup than Bitwarden clients
- Family sharing requires either shared access to the same file or separate vaults

**Verdict:** Best for solo users or tech-comfortable households. For family sharing with less technical members, the sync setup adds friction that Vaultwarden avoids.

## Summary table

| | Vaultwarden | Official Bitwarden | KeePass |
|---|---|---|---|
| Resource use | ~10MB RAM | 1–2GB RAM | None (local file) |
| Setup complexity | Low | High | Low–Medium |
| Family sharing | Built-in | Built-in | Manual sync required |
| Mobile UX | Excellent (Bitwarden clients) | Excellent | Good |
| Backup | Copy SQLite file | Complex (multi-DB) | Copy `.kdbx` file |
| Audit status | Community | Official Bitwarden | KDBX format audited |
| Cost | Free | Free | Free |

**Winner for household self-hosting: Vaultwarden.** See [[research/password-managers/self-hosting-guide|self-hosting guide]] for setup.
