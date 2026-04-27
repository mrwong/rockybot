# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and adjust.

## Required

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for pay-per-use billing. Required unless using subscription mode exclusively and you never hit rate limits. Get one at [console.anthropic.com](https://console.anthropic.com/). |

## Paths

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `/vault` | Path inside the container where the Obsidian vault is mounted. Must match your volume mount. |

## Billing and auth

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_SUBSCRIPTION_MODE` | `false` | Set to `true` to use Claude Pro/Max subscription billing first, falling back to API key on auth errors or rate limits. Requires mounting `~/.claude` into the container. |

## Polling

| Variable | Default | Description |
|---|---|---|
| `INBOX_POLL_SECONDS` | `600` | How often (in seconds) to check the vault for work. All five watchers run on this interval. 600s = 10 minutes. |

## Spending caps

Each cap limits how much Claude API spend a single watcher invocation can incur. The bot will stop the Claude process if the budget is exhausted mid-run.

| Variable | Default | Description |
|---|---|---|
| `RESEARCH_BUDGET_USD` | `2.00` | Per research request (inbox watcher). New research tasks can be multi-page and use web search, so this is higher. |
| `AMEND_BUDGET_USD` | `0.50` | Per `[!claude]` callout file (amend watcher). These are targeted inline edits. |
| `EXPAND_BUDGET_USD` | `1.00` | Per `[!expand]` callout file (expand watcher). Creates a new sub-page. |
| `REVISE_BUDGET_USD` | `4.00` | Per `[!revise]` callout file (revise watcher). Revises all linked sub-pages, so budget is higher. |
| `LINT_BUDGET_USD` | `5.00` | Per lint pass (lint watcher). Audits the full research wiki, so budget is highest. |

Note: budget caps only apply when `CLAUDE_SUBSCRIPTION_MODE=false` or when falling back to API key billing.

## Model selection

| Variable | Default | Description |
|---|---|---|
| `AMEND_MODEL` | `haiku` | Claude model for `[!claude]` amend tasks. Haiku is faster and cheaper for targeted edits. |
| `EXPAND_MODEL` | `sonnet` | Claude model for `[!expand]` tasks. Sonnet for better research quality. |
| `REVISE_MODEL` | `sonnet` | Claude model for `[!revise]` tasks. |
| `LINT_MODEL` | `sonnet` | Claude model for lint passes. |

The inbox watcher always uses `sonnet` (hardcoded) — new research tasks benefit from the full model capability.

Valid model values: `haiku`, `sonnet`, `opus`. Maps to the latest Claude model in each tier.

## Notifications

All notification variables are optional. If left blank, that notification channel is silently disabled.

### Discord

| Variable | Description |
|---|---|
| `DISCORD_WEBHOOK_URL` | Webhook URL for a Discord channel. rockybot posts an embed on each watcher completion and on Claude auth expiry. See [NOTIFICATIONS.md](NOTIFICATIONS.md) for setup. |

### WhatsApp via Twilio

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM` | Sender number, e.g. `whatsapp:+14155238886` (Twilio sandbox) |
| `TWILIO_TO` | Your WhatsApp number, e.g. `whatsapp:+15551234567` |

All four Twilio vars must be set for WhatsApp notifications to send. Any missing var disables the whole channel.

## Development and testing

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `false` | Set to `true` to run all watchers in dry-run mode: they detect pending files and log what they would do, but do not call Claude and do not modify any vault files. Useful for testing vault scanning without spending API budget. |

## Obsidian Bridge (full stack only)

| Variable | Default | Description |
|---|---|---|
| `DOMAIN_NAME` | `localhost` | Domain used to configure the Quartz static site base URL. Set to your domain, e.g. `notes.example.com`. |
| `QUARTZ_OUTPUT` | `/quartz-output` | Path inside the bridge container where Quartz builds the static site. Must match the volume mount for notes-web. |
