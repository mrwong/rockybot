# Development Guide

## Architecture overview

rockybot is a Node.js process that polls an Obsidian vault directory every N seconds. On each poll it runs five watchers in sequence, serialized behind a global mutex (only one Claude invocation at a time):

```
index.js (poll loop)
  ├─ discordBot.init()                        ← connects Discord bot if DISCORD_INTERACTIVE_AUTH=true
  └─ withGlobalLock('inbox',  scanInbox)      ← processes research requests
  └─ withGlobalLock('amend',  scanAmendments) ← [!claude] callouts
  └─ withGlobalLock('expand', scanExpands)    ← [!expand] callouts
  └─ withGlobalLock('revise', scanRevisions)  ← [!revise] callouts
  └─ withGlobalLock('lint',   scanLint)       ← lint-trigger.md

Each watcher:
  1. Scans vault directory for matching files
  2. Loads prompt template from vault (falls back to built-in)
  3. Substitutes tokens: {{VAULT_PATH}}, {{FILE_PATH}}, {{SEED_CONTENTS}}
  4. Calls runClaude(prompt, vaultPath, { budgetUsd, tools, model, label })
  5. claude-runner.js spawns: claude --print <prompt> --allowedTools ... --model ...
     On subscription auth failure (interactive mode):
       login-runner.js spawns `claude login`, captures OAuth URL
       discord-bot.js posts URL + buttons, waits for user response or timeout
  6. On completion, notifier.js sends Discord/WhatsApp notification
```

## Callout detection — critical rules

Each callout watcher (amend, expand, revise) scans `research/**/*.md` for its trigger string. **Always use an anchored regex, never a bare string search:**

```js
// CORRECT — only matches a real Obsidian callout at line start
if (/^>\s*\[!claude\]/m.test(content)) results.push(file);

// WRONG — matches prose mentions like "unlike [!claude]..." in prompt files
if (content.includes('[!claude]')) results.push(file);
```

Why this matters: prompt template files (`*-prompt.md`) explain how callouts work and contain sentences like *"use a `[!claude]` callout to..."*. A bare `.includes()` matches those mentions on every poll cycle, triggering Claude invocations with no user intent and burning budget continuously.

## EXCLUDED_NAMES — the prompt file blocklist

Every callout watcher maintains an `EXCLUDED_NAMES` set of filenames that must never be processed, even if they contain callout syntax:

```js
const EXCLUDED_NAMES = new Set([
  'amend-prompt.md',
  'expand-prompt.md',
  'revise-prompt.md',
  'lint-prompt.md',
  'research-prompt.md',
]);
```

**Rule: when adding a new `*-prompt.md` template, add its filename to `EXCLUDED_NAMES` in EVERY existing watcher** — not just the one that owns it. New prompt files almost always mention other callout types in their explanatory text.

This rule was learned the hard way: a prompt file added in April 2026 was missing from two watchers' exclusion lists. Both watchers matched it on every 10-minute poll for several hours before the bug was caught.

## Adding a new watcher

Follow this checklist in order:

1. **Create the source file** at `services/bot/src/<name>-watcher.js`
   - Export a `scan<Name>()` function
   - Use anchored regex for callout detection
   - Add `EXCLUDED_NAMES` set (copy from an existing watcher; add the new prompt filename too)
   - Read the prompt template from vault with fallback to a built-in string
   - Call `runClaude(prompt, vaultPath, { budgetUsd, tools, model })`

2. **Wire into `index.js`**:
   ```js
   const { scanMyFeature } = require('./myfeature-watcher');
   // in pollAll():
   await withGlobalLock('myfeature', scanMyFeature);
   ```
   Add a poll interval env var if the watcher should be configurable.

3. **Add the prompt template** to `vault-scaffold/research/<name>-prompt.md`
   - Use `{{VAULT_PATH}}` and `{{FILE_PATH}}` tokens — never hardcode paths
   - Document what the watcher does and how to write good callout instructions
   - Add the new filename (`<name>-prompt.md`) to `EXCLUDED_NAMES` in every other watcher

4. **Add env vars** to `docker-compose.yml`:
   ```yaml
   - <NAME>_BUDGET_USD=1.00
   - <NAME>_MODEL=sonnet
   ```

5. **Add the prompt filename to every existing watcher's `EXCLUDED_NAMES`**:
   - `amend-watcher.js`
   - `expand-watcher.js`
   - `revise-watcher.js`
   - `lint-watcher.js`
   - (and any future watchers)

6. **Add an Obsidian template** (optional) to `templates/<name>-task.md` for quick insertion

7. **Write tests** in `tests/unit/<name>-watcher.test.js`:
   - Test callout detection regex (match + no-match cases)
   - Test EXCLUDED_NAMES correctly blocks prompt files
   - Mock `claude-runner.js` to avoid real Claude calls

8. **Update docs**:
   - Add a section to `docs/WORKFLOW.md`
   - Add a row to `docs/CONFIGURATION.md` for the new env vars
   - Update `README.md` feature list

## Race condition in inbox watcher

The inbox watcher moves the seed file to `research/processed/` **before** calling `runClaude()`. This is intentional:

Obsidian Sync conflict resolution can overwrite a file mid-run if the same file exists on both ends. If we set `status: processing` and left the file in `inbox/`, Obsidian could restore the original `status: pending` version during the Claude run, causing re-processing on the next tick.

Moving the file out of `inbox/` removes it from Obsidian's sync scope before Claude touches the vault. The file is only moved back to `inbox/` on error or `awaiting-input`.

## DRY_RUN mode

Set `DRY_RUN=true` to run the bot without calling Claude. Watchers scan the vault and log what they would process, but no Claude invocations happen and no vault files are modified.

Use this to:
- Verify callout detection is working
- Test vault scanning without spending API budget
- Smoke-test a new vault directory

```bash
docker run --rm \
  -e VAULT_PATH=/vault \
  -e DRY_RUN=true \
  -v /path/to/vault:/vault \
  ghcr.io/mrwong/rockybot:latest
```

## Running tests locally

**Unit tests** (no Docker, no Claude — but requires Node.js on the host):

```bash
npm install
npm test
```

**Integration tests** run in a pre-baked Docker image so no host Node.js is needed:

```bash
npm run test:integration:docker
```

This builds `Dockerfile.test` on first run (caches `npm ci` layer), then mounts the source live. Subsequent runs skip the install and start in ~3 seconds. Rebuild the image only when `package.json` changes:

```bash
docker compose -f docker-compose.test.yml build
```

The integration suite covers three surface areas with 49 tests — no Claude API key required:
- **`quartz-builder`** — `getPublishedTopics` vault scanning and publish flag filtering
- **`export-builder`** — `rewriteHtml` HTML rewriting and `buildTopicExport` ZIP structure
- **`http-server`** — full HTTP server: routing, slug format gate, publish whitelist, 503/429 guards

## Local development with docker-compose.dev.yml

The dev compose file builds from source and mounts vault to `/tmp/rockybot-dev-vault`, keeping it separate from any live vault:

```bash
cp .env.example .env
# set ANTHROPIC_API_KEY in .env
docker compose -f docker-compose.dev.yml up
```

The source files in `services/bot/src/` are bind-mounted into the container, so JS changes take effect on the next poll without rebuilding the image.

To rebuild the image (needed for Dockerfile or scaffold changes):

```bash
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up
```

## Branch strategy

| Branch | Image tag | Purpose |
|---|---|---|
| `dev` | `edge` | Pre-release — all feature work merges here first |
| `main` | `latest` | Stable — only receives PRs from `dev` at release time |
| `v1.2.3` tag | `1.2.3`, `1.2` | Pinned release |
| `v1.2.3-rc.1` tag | `1.2.3-rc.1` | Pre-release tag — no `latest` |

Open PRs against `dev`, not `main`. When `dev` is stable and ready to ship, open a PR from `dev` → `main`, then run the release script on `main`.

## Publishing a new version

```bash
# 1. All integration tests green
npm run test:integration:docker

# 2. Merge dev → main (PR or direct push)
git checkout main && git merge dev && git push origin main

# 3. Run release script on main — bumps versions, updates CHANGELOG, tags
./scripts/release.sh

# 4. Push the tag — triggers GitHub Actions to publish Docker images
git push origin main --tags
```

The script shows commits since the last tag grouped by type, proposes a semver bump (major/minor/patch), asks you to confirm or override, then commits and tags.

**5. Redeploy your infrastructure** — update `docker-compose.yml` to the new image tag (or pull `:latest`), push to trigger GitOps, then verify the correct version is live:

```bash
curl https://notes.yourdomain/version
# → {"version":"1.1.0"}
```

Wait until the endpoint returns the new version before smoke-testing. The bridge exposes this at `/version` (proxied through nginx); it reads from the baked-in `package.json` so it always reflects the running image's version.

See `CLAUDE.md` for the full versioning policy, including which commit prefixes map to which bump levels and what counts as a docs-only change (no bump).
