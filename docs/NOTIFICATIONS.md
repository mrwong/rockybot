# Notifications

rockybot can send notifications when watchers complete (or fail) and when the Claude subscription session expires. Both channels are optional — if not configured, the bot runs silently.

## Discord

### Setup

1. Open the Discord server where you want notifications
2. Go to **Server Settings → Integrations → Webhooks → New Webhook**
3. Give it a name (e.g. "rockybot"), pick a channel, and copy the webhook URL
4. Add it to your `.env`:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### What gets notified

- **Research complete** — when the inbox watcher finishes processing a request
- **Amend / expand / revise complete** — when a callout watcher finishes a file
- **Lint complete** — when a lint pass finishes
- **Error** — when any watcher fails (includes error message)
- **Claude auth expired** — when subscription mode fails with an auth error (throttled to max 2 alerts per day; bot automatically retries with API key)

### Embed format

Each notification is a Discord embed with:
- Title: watcher name + status (✅ or ❌)
- Description: file processed (for callout watchers) or topic (for inbox)
- Color: green for success, red for error

## WhatsApp via Twilio

### Setup

1. Create a [Twilio](https://www.twilio.com/) account
2. Enable the **WhatsApp Sandbox** in the Twilio console (Messaging → Try it Out → Send a WhatsApp message)
3. Follow the sandbox join instructions on your phone (send a join code to the sandbox number)
4. Add all four vars to your `.env`:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM=whatsapp:+14155238886
TWILIO_TO=whatsapp:+15551234567
```

`TWILIO_FROM` is the Twilio sandbox number (shown in the console). `TWILIO_TO` is your personal WhatsApp number in E.164 format with the `whatsapp:` prefix.

### What gets notified

Same events as Discord — WhatsApp and Discord fire for the same events. You can enable both, either, or neither.

### Moving to a production WhatsApp number

The sandbox requires re-joining every 72 hours. For persistent notifications, apply for a Twilio WhatsApp sender in the Twilio console. The environment variables are the same; only `TWILIO_FROM` changes to your approved sender number.

## Testing notifications

Set `DRY_RUN=true` and check that the bot starts without errors. Notifications only fire on real watcher completions, so to test a notification end-to-end: create a minimal research request in `research/inbox/` with `status: pending`, wait for the next poll cycle (or restart with a short `INBOX_POLL_SECONDS=10`), and verify the notification arrives.
