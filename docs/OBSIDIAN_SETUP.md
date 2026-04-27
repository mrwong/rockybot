# Obsidian Setup

This guide covers the one-time setup steps to get the most out of rockybot inside Obsidian. You can use the bot without any of this — it works on the vault directory directly — but these settings make inserting tasks much smoother.

---

## Templates plugin (for callout shortcuts)

rockybot seeds an Obsidian `templates/` folder into your vault containing four task templates:

| Template | Inserts |
|---|---|
| `Research Request` | A new inbox request with all frontmatter fields |
| `Claude Task` | A `> [!claude]` callout ready to fill in |
| `Expand Task` | A `> [!expand]` callout with an instruction block |
| `Revise Task` | A `> [!revise]` callout with a revision brief |

### Enable the Templates plugin

1. In Obsidian, open **Settings → Core plugins**
2. Enable **Templates**
3. Open **Settings → Templates**
4. Set **Template folder location** to `templates`

### Using a template

`Cmd/Ctrl+P` → **Templates: Insert template** → pick the template you want.

Or assign a hotkey: **Settings → Hotkeys** → search for "Templates: Insert template".

---

## Full Obsidian Sync stack (optional)

rockybot can run against any directory your desktop Obsidian already syncs. If you want the bot to run on a server and sync back to your devices via **Obsidian Sync**, you need the headless Obsidian container (`rockybot-headless`).

### First-time interactive setup

The headless container requires a one-time interactive login to connect it to your Obsidian Sync account.

1. Start the headless container and open a shell into it:

```bash
docker compose up -d obsidian-headless
docker exec -it rockybot-headless bash
```

2. Inside the container, start Obsidian in a virtual display and log in to Obsidian Sync. The headless image includes a VNC server so you can connect a viewer if needed:

```bash
# Inside the container
/entrypoint.sh &
# Connect a VNC client to localhost:5900 (or tunnel via SSH)
# Log in to Obsidian, enable Sync, choose your vault
```

Alternatively, if your vault directory is already populated (e.g., from a local Obsidian installation), you can skip the headless login entirely — mount the vault directory directly and let rockybot use it as-is:

```yaml
# docker-compose.yml snippet
bot:
  volumes:
    - /path/to/your/existing/vault:/vault
```

3. After login, the `data/obsidian-config/` directory on the host holds the Obsidian credentials. They persist across container restarts.

### Verify sync is running

```bash
docker logs rockybot-headless --tail 20
# Should show Obsidian running and vault synced
```

---

## Vault location

rockybot mounts the vault as `/vault` inside the container (configurable via `VAULT_PATH`). On first start it seeds `research/` and `templates/` into the vault — these appear in Obsidian on the next sync.

If your vault already has a `research/` folder from previous use, rockybot never overwrites existing files. Only missing files are seeded.

---

## Recommended Obsidian settings

| Setting | Recommended | Why |
|---|---|---|
| **Files & Links → Use `[[Wikilinks]]`** | On | rockybot creates wikilinks in research output |
| **Files & Links → New link format** | Relative path | Prevents broken links if you reorganize |
| **Editor → Fold heading** | On | Research pages can be long; folding helps navigate |
| **Files & Links → Detect all file extensions** | Off | Not needed; all rockybot output is `.md` |

---

## Community plugins (optional)

None are required. These are popular with users of the research wiki pattern:

- **Dataview** — query and table research topics (e.g., show all pages updated this week)
- **Breadcrumbs** — visualize parent/child relationships in the research hierarchy
- **Zotero Integration** — if you want to link research pages to academic papers
