# Obsidian Setup

This guide covers the one-time setup steps to connect rockybot to your Obsidian vault and get the most out of its task templates.

---

## How vault sync works

rockybot reads from and writes to a directory. To see its output in Obsidian on your devices, that directory needs to stay in sync.

**If Obsidian is on the same machine as the bot:** Mount Obsidian's local vault folder directly. Changes rockybot writes are immediately visible in Obsidian. No sync service needed.

**If rockybot runs on a server:** You need a sync mechanism between the server and your devices. The only option that works reliably is **[Obsidian Sync](https://obsidian.md/sync)** — Obsidian's first-party service ($4–10/month depending on plan).

### Why not LiveSync (self-hosted)?

[Obsidian LiveSync](https://github.com/vrtmrz/obsidian-livesync) is a popular community plugin that self-hosts vault sync on CouchDB. It was the first thing we tried. It didn't work reliably for this use case for a few reasons:

**New-file detection was unreliable.** rockybot creates new `.md` files in the vault directory by writing to the filesystem directly — it doesn't go through Obsidian's plugin API. LiveSync's sync daemon running in headless mode didn't consistently detect these new files and push them to client devices. Files would appear eventually, or sometimes not at all without a manual sync trigger.

**Conflict resolution is fragile.** rockybot modifies files while Obsidian Sync is active. The official Obsidian Sync service handles these conflicts cleanly because it's built into Obsidian's core sync engine. LiveSync's CouchDB-based conflict resolution produced corrupted notes in some cases when the bot and a user edited the same file close together.

**Additional infrastructure.** LiveSync requires running a CouchDB instance and configuring the plugin on every client device. The operational overhead outweighed the cost savings.

If you're determined to avoid a paid sync subscription, the alternative is a shared filesystem that both the server and your devices can access (NFS, Syncthing, rsync-on-a-schedule). rockybot doesn't care how the directory gets populated — it just reads and writes files. The tradeoff is that setup and conflict handling are entirely your responsibility.

---

## Headless Obsidian Sync setup

If rockybot runs on a server, you need the `rockybot-headless` container, which runs a real headless Obsidian process and handles Obsidian Sync.

### Before you start

- You need an **Obsidian Sync** subscription. Sign up at [obsidian.md/sync](https://obsidian.md/sync).
- You need a vault already set up in Obsidian Sync (created from any of your devices).

### First-time interactive login

The headless container requires a one-time interactive session to log in to your Obsidian account and connect to your vault. You'll use VNC to interact with a graphical Obsidian window running inside the container.

**1. Start the headless container:**

```bash
docker compose up -d obsidian-headless
```

**2. Open an SSH tunnel from your local machine to the server** (skip if you're already on the server):

```bash
ssh -L 5900:localhost:5900 user@your-server
```

This forwards port 5900 (VNC) from the server to your local machine.

**3. Connect a VNC client to `localhost:5900`.**

Any VNC client works:
- macOS: built-in Screen Sharing app, or [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/)
- Windows/Linux: [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/) or TigerVNC

You should see a desktop with an Obsidian window.

**4. In Obsidian:**

- Sign in to your Obsidian account (**Settings → About → Log in**)
- Enable Sync (**Settings → Core plugins → Sync → Enable**)
- Choose your vault from the remote vault list
- Wait for the initial sync to complete (watch the status icon in the bottom-right)

**5. Close the VNC session.** The container keeps running and syncing in the background.

**6. Verify:**

```bash
docker logs rockybot-headless --tail 20
```

You should see Obsidian running without errors. The `data/vault/` directory on the host should now contain your vault files.

> **Subsequent restarts:** After the initial login, Obsidian Sync credentials are stored in `data/obsidian-config/` on the host. The container reconnects automatically on restart — no interactive login needed again.

---

## Templates setup

rockybot seeds an Obsidian `templates/` folder into your vault with four task templates:

| Template | What it inserts |
|---|---|
| `Research Request` | A new inbox request with frontmatter, scope checklist, and question sections |
| `Claude Task` | A `> [!claude]` callout ready to type your instruction |
| `Expand Task` | A `> [!expand]` callout with an instruction block below |
| `Revise Task` | A `> [!revise]` callout with a revision brief block |

There are two ways to use these templates in Obsidian: the **core Templates plugin** (simpler) or the **Templater community plugin** (recommended — more flexible and works better for inserting callouts mid-file).

### Option 1: Core Templates plugin

1. Open **Settings → Core plugins** and enable **Templates**
2. Open **Settings → Templates**, set **Template folder location** to `templates`
3. To insert a template: `Cmd/Ctrl+P` → **Templates: Insert template** → pick one

The `{{date:YYYY-MM-DD}}` placeholder in the Research Request template is resolved automatically by the core plugin.

### Option 2: Templater (community plugin — recommended)

[Templater](https://github.com/SilentVoid13/Templater) is a community plugin that handles the same templates with more flexibility, including the ability to trigger template insertion from a hotkey directly on the current file. This is particularly useful for the callout templates (`[!claude]`, `[!expand]`, `[!revise]`), which you'll insert into existing notes rather than creating new files.

**Setup:**

1. Open **Settings → Community plugins** → Browse → search "Templater" → Install → Enable
2. Open **Settings → Templater**, set **Template folder location** to `templates`
3. Optionally set **Trigger Templater on new file creation** to auto-fill the Research Request template whenever you create a new note in `research/inbox/`

**Using a template:**

`Cmd/Ctrl+P` → **Templater: Open Insert Template Modal** → pick the template. The callout is inserted at your cursor position.

Assign a hotkey for even faster insertion: **Settings → Hotkeys** → search "Templater: Open Insert Template Modal".

> **Note:** The `{{date:YYYY-MM-DD}}` syntax in `research-request.md` works with both the core plugin and Templater — no changes to the template files are needed.

---

## Recommended Obsidian settings

| Setting | Recommended | Why |
|---|---|---|
| **Files & Links → Use `[[Wikilinks]]`** | On | rockybot creates wikilinks in research output |
| **Files & Links → New link format** | Relative path | Prevents broken links if you reorganize |
| **Editor → Fold heading** | On | Research pages can be long; folding helps navigate |

---

## Community plugins (optional)

None are required. These are popular with users of the research wiki pattern:

- **Dataview** — query and table research topics (e.g., show all pages updated this week)
- **Breadcrumbs** — visualize parent/child relationships in the research hierarchy
- **Zotero Integration** — if you want to link research pages to academic papers
