'use strict';

const https  = require('https');
const logger = require('./logger');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN   || '';
const TWILIO_FROM         = process.env.TWILIO_FROM         || '';
const TWILIO_TO           = process.env.TWILIO_TO           || '';

const COLOR_SUCCESS = 3066993;  // green
const COLOR_ERROR   = 15158332; // red
const COLOR_WARN    = 16776960; // yellow

// Throttle: send at most 1 auth-expired alert per 12 hours (max 2x/day).
// In-memory is sufficient — auth errors don't cause crashloops, so state
// survives across poll cycles. Resets on container restart, which is fine
// (a restart is itself a valid reason to re-alert).
let lastAuthNotifyMs = 0;
const AUTH_NOTIFY_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function httpsPost(url, body, { headers = {}, auth } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    if (auth) opts.auth = auth;
    const req = https.request(opts, res => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendDiscord(title, description, color) {
  const body = JSON.stringify({ embeds: [{ title, description, color }] });
  await httpsPost(DISCORD_WEBHOOK_URL, body, {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sendWhatsApp(message) {
  const body = new URLSearchParams({ From: TWILIO_FROM, To: TWILIO_TO, Body: message }).toString();
  await httpsPost(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    body,
    {
      auth: `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
}

// notify({ watcher: 'inbox', label: 'china-trip.md', status: 'success' | 'error', error: '...' })
// No-op if no notification env vars are set. Never throws.
async function notify({ watcher, label, status, error }) {
  if (!DISCORD_WEBHOOK_URL && !TWILIO_ACCOUNT_SID) return;

  const isError = status === 'error';
  const title = isError ? `❌ ${watcher} failed` : `✅ ${watcher} complete`;
  const description = error ? `${label}\n${error}` : label;
  const color = isError ? COLOR_ERROR : COLOR_SUCCESS;

  const tasks = [];
  if (DISCORD_WEBHOOK_URL) {
    tasks.push(
      sendDiscord(title, description, color)
        .catch(e => logger.warn(`Discord notify failed: ${e.message}`))
    );
  }
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM && TWILIO_TO) {
    tasks.push(
      sendWhatsApp(`${title}: ${description}`)
        .catch(e => logger.warn(`WhatsApp notify failed: ${e.message}`))
    );
  }
  await Promise.all(tasks);
}

// Fires a Discord alert when Claude subscription auth has lapsed.
// Rate-limited to at most 2x per day to avoid spam during continuous poll cycles.
// Never throws.
async function notifyAuthExpired() {
  const now = Date.now();
  if (now - lastAuthNotifyMs < AUTH_NOTIFY_COOLDOWN_MS) return;
  lastAuthNotifyMs = now;

  if (!DISCORD_WEBHOOK_URL) return;

  const title = '🔐 rockybot: Claude auth expired';
  const description =
    'Subscription billing has lapsed. Falling back to API key for now.\n\n' +
    '**To restore:** Run `claude login` on the Docker host, then restart the bot container.';

  await sendDiscord(title, description, COLOR_WARN)
    .catch(e => logger.warn(`Discord auth notify failed: ${e.message}`));
}

// Fires when subscription billing hits the usage limit (webhook-only / non-interactive mode).
// Never throws.
async function notifyRateLimitHit(label, resetTime) {
  if (!DISCORD_WEBHOOK_URL) return;
  const resetStr = resetTime
    ? `Resets at **${resetTime.toUTCString()}** — holding until then.`
    : 'Reset time unknown — will retry every 30 minutes.';
  const taskLine = label ? `\n**Task:** *${label}*` : '';
  await sendDiscord(
    '⏳ rockybot: Claude usage limit reached',
    `Subscription billing is paused.${taskLine}\n${resetStr}`,
    COLOR_WARN,
  ).catch(e => logger.warn(`Discord rate-limit notify failed: ${e.message}`));
}

// Fires when the 24h hold expires and the bot gives up waiting. Never throws.
async function notifyRateLimitFallback(label) {
  if (!DISCORD_WEBHOOK_URL) return;
  const taskLine = label ? `\n**Task:** *${label}*` : '';
  await sendDiscord(
    '💰 rockybot: Rate limit hold expired — using API key',
    `Still rate-limited after 24 hours.${taskLine}\nFalling back to API key billing now.`,
    COLOR_WARN,
  ).catch(e => logger.warn(`Discord rate-limit fallback notify failed: ${e.message}`));
}

module.exports = { notify, notifyAuthExpired, notifyRateLimitHit, notifyRateLimitFallback };
