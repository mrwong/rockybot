---
tags: [research, passwords, security, self-hosting]
created: 2026-01-15
related: ["[[research/index]]"]
sources:
  - url: https://vaultwarden.github.io/vaultwarden/
    title: "Vaultwarden documentation"
  - url: https://bitwarden.com/open-source/
    title: "Bitwarden open-source resources"
  - url: https://keepass.info/
    title: "KeePass official site"
---

# Self-hosted Password Managers

A survey of self-hosted password manager options for household use, comparing security model, ease of setup, and usability for non-technical family members.

## TL;DR

**[[research/password-managers/options-comparison|Vaultwarden]]** is the best choice for most self-hosters: it's a lightweight [Bitwarden](https://bitwarden.com)-compatible server written in Rust, runs on minimal hardware, and the Bitwarden mobile/desktop clients are polished enough for non-technical users. KeePass is excellent for single-user or tech-savvy households but sync requires additional tooling.

## Sub-pages

- [[research/password-managers/options-comparison|Options comparison]] — Vaultwarden vs. official Bitwarden vs. KeePass
- [[research/password-managers/self-hosting-guide|Self-hosting guide]] — Docker Compose setup for Vaultwarden
- [[research/password-managers/tradeoffs|Tradeoffs]] — security model, backup strategy, migration path

## Key findings

1. **Vaultwarden** is a community-maintained Bitwarden API-compatible server. It uses a fraction of the resources of the official Bitwarden server and is actively maintained. All official Bitwarden clients work with it.

2. **Official Bitwarden server** is open-source but requires significant resources (SQL Server or SQLite + multiple services). Overkill for household use.

3. **KeePass / KeePassXC** stores credentials in an encrypted local file. Sync requires a solution like Syncthing or a cloud drive. Works well for technical users; friction for family sharing.

4. **Backup** is the most overlooked concern — a self-hosted vault without automated offsite backup is a single point of failure. See [[research/password-managers/tradeoffs|tradeoffs]] for the backup strategy.

## Related research

- [[research/index|Research index]]
