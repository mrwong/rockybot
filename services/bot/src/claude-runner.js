'use strict';

const { spawn } = require('child_process');
const { notifyAuthExpired, notifyRateLimitHit, notifyRateLimitFallback } = require('./notifier');
const discordBot = require('./discord-bot');
const { startLogin } = require('./login-runner');
const logger = require('./logger');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const SUBSCRIPTION_MODE = (process.env.CLAUDE_SUBSCRIPTION_MODE || '').toLowerCase() === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';

const AUTH_PATTERNS       = ['unauthenticated', 'not logged in', 'login required', '401', 'unauthorized', 'authentication failed', 'invalid credentials', 'oauth', 'configuration file not found', 'not authenticated'];
const RATE_LIMIT_PATTERNS = ['rate limit', 'quota exceeded', 'overloaded', '529', 'usage limit', 'too many requests', 'hit your limit'];

const RATE_LIMIT_MAX_WAIT_MS  = 24 * 60 * 60 * 1000;
const RATE_LIMIT_POLL_MS      = 30 * 60 * 1000;
const RATE_LIMIT_RESET_BUFFER = 2 * 60 * 1000;

// Classify combined stdout+stderr to determine the failure mode.
function classifyOutput(stderr, stdout = '') {
  const s = (stderr + '\n' + stdout).toLowerCase();
  if (AUTH_PATTERNS.some(p => s.includes(p)))       return 'auth';
  if (RATE_LIMIT_PATTERNS.some(p => s.includes(p))) return 'rate-limit';
  return 'other';
}

// Parse "resets 7am (UTC)" or "resets 7:30pm (UTC)" from Claude's usage-limit message.
// Returns a Date (UTC) just after the reset, or null if not found.
function parseResetTime(text) {
  const m = text.match(/resets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?(am|pm)\s*\(UTC\)/i);
  if (!m) return null;

  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3].toLowerCase();
  if (ampm === 'pm' && hours !== 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0));
  // If already past that time today, it resets tomorrow
  if (reset.getTime() <= Date.now()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Spawns claude, streaming stdout/stderr to process output.
// Resolves with { ok, stderr, stdout } rather than rejecting so the caller can
// inspect the error type before deciding whether to fall back.
function spawnClaude(prompt, cwd, { budgetUsd, tools, model, useApiKey }) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print', prompt,
      '--allowedTools', tools,
      '--model', model,
    ];
    // --max-budget-usd only applies to API-key billing
    if (useApiKey) args.push('--max-budget-usd', String(budgetUsd));

    const env = { ...process.env };
    if (!useApiKey) delete env.ANTHROPIC_API_KEY;

    const proc = spawn(CLAUDE_BIN, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stderrBuf = '';
    let stdoutBuf = '';
    let stdoutLen = 0;
    proc.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      const s = chunk.toString();
      stdoutBuf += s;
      stdoutLen += s.length;
    });
    proc.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      stderrBuf += chunk.toString();
    });
    proc.on('error', reject);
    // Claude exits 0 but produces no stdout when auth fails silently (expired session,
    // missing config) — treat empty stdout as a failure so the caller can fall back.
    proc.on('close', code => resolve({ ok: code === 0 && stdoutLen > 0, stderr: stderrBuf, stdout: stdoutBuf }));
  });
}

// Handles a subscription auth failure.  In interactive mode: spawns `claude login`,
// posts the OAuth URL to Discord, and waits for the user to decide.
// In basic mode: fires a throttled Discord alert and falls back immediately.
// Returns 'use-api-key' | 'retry-subscription'.
async function handleAuthFailure(label) {
  if (discordBot.isEnabled()) {
    logger.warn('claude-runner: subscription auth failed — starting OAuth flow, posting to Discord');
    try {
      const { url, proc } = await startLogin();
      return await discordBot.askAuthDecision(label, url, proc);
    } catch (err) {
      logger.warn(`claude-runner: could not start login flow (${err.message}) — falling back to API key`);
      return 'use-api-key';
    }
  }

  logger.warn('claude-runner: subscription auth failed — notifying Discord, falling back to API key');
  await notifyAuthExpired();
  return 'use-api-key';
}

// Handles a subscription rate-limit hit.
// Interactive mode: posts Discord buttons ("Wait for reset" / "Use API Key").
// Webhook-only mode: posts a notification and auto-waits.
// If waiting: holds the mutex, sleeping until the parsed reset time (+ buffer),
// retrying subscription on each wake. Falls back to API key after 24h.
// Returns 'ok' (subscription succeeded after wait) | 'use-api-key'.
async function handleRateLimitFailure(label, stderr, stdout, retryFn) {
  const combined = stderr + '\n' + stdout;
  const resetTime = parseResetTime(combined);
  const resetStr = resetTime ? resetTime.toUTCString() : 'unknown';
  logger.warn(`claude-runner: subscription usage limit hit — resets at ${resetStr}`);

  let decision;
  if (discordBot.isEnabled()) {
    decision = await discordBot.askRateLimitDecision(label, resetTime);
  } else {
    await notifyRateLimitHit(label, resetTime);
    decision = 'wait-for-reset';
  }

  if (decision === 'use-api-key') return 'use-api-key';

  // Hold and retry loop — 24h hard cap
  const deadline = Date.now() + RATE_LIMIT_MAX_WAIT_MS;
  let currentResetTime = resetTime;

  while (Date.now() < deadline) {
    const now = Date.now();
    let sleepMs;
    if (currentResetTime && currentResetTime.getTime() + RATE_LIMIT_RESET_BUFFER > now) {
      sleepMs = Math.min(currentResetTime.getTime() + RATE_LIMIT_RESET_BUFFER - now, deadline - now);
    } else {
      sleepMs = Math.min(RATE_LIMIT_POLL_MS, deadline - now);
    }

    if (sleepMs > 0) {
      logger.info(`claude-runner: rate limit hold — sleeping ${Math.round(sleepMs / 60000)}m`);
      await sleep(sleepMs);
    }

    if (Date.now() >= deadline) break;

    logger.info('claude-runner: retrying subscription after rate limit hold');
    const result = await retryFn();
    if (result.ok) return 'ok';

    const type = classifyOutput(result.stderr, result.stdout);
    if (type !== 'rate-limit') {
      throw new Error(`claude (after rate limit hold) failed: ${result.stderr.slice(0, 300)}`);
    }
    // Still limited — refresh reset time and loop
    currentResetTime = parseResetTime(result.stderr + '\n' + result.stdout) || currentResetTime;
    logger.warn(`claude-runner: still rate-limited — next reset: ${currentResetTime ? currentResetTime.toUTCString() : 'unknown'}`);
  }

  logger.warn('claude-runner: 24h rate limit hold exceeded — falling back to API key');
  await notifyRateLimitFallback(label);
  return 'use-api-key';
}

// Invokes claude, trying subscription billing first when CLAUDE_SUBSCRIPTION_MODE=true.
// On auth error: enters interactive Discord flow (if enabled) or falls back automatically.
// On rate-limit: posts Discord notification, holds mutex until reset, retries subscription.
//   User can override via Discord button to use API key immediately.
//   Falls back to API key automatically after 24h if still limited.
// When DRY_RUN=true, logs the call parameters and returns without running Claude.
//
// label (optional) — human-readable task name shown in Discord prompts.
async function runClaude(prompt, cwd, { budgetUsd = '2.00', tools = 'Bash,Edit,Read,Write,Glob,Grep,WebSearch,WebFetch', model = 'sonnet', label = '' } = {}) {
  if (DRY_RUN) {
    logger.info(`claude-runner: DRY_RUN — would call claude model=${model} budget=${budgetUsd} tools=${tools} cwd=${cwd}`);
    return;
  }
  const opts = { budgetUsd, tools, model };

  if (SUBSCRIPTION_MODE) {
    logger.info('claude-runner: trying subscription billing');
    const result = await spawnClaude(prompt, cwd, { ...opts, useApiKey: false });
    if (result.ok) return;

    const errorType = classifyOutput(result.stderr, result.stdout);
    const trulySilent = result.stderr.trim().length === 0 && result.stdout.trim().length === 0;

    if (errorType === 'auth' || trulySilent) {
      if (trulySilent) {
        logger.warn('claude-runner: subscription billing exited silently with no output — session may be expired; run "claude login" on the host to restore subscription billing.');
      }

      const decision = await handleAuthFailure(label);

      if (decision === 'retry-subscription') {
        logger.info('claude-runner: retrying with subscription billing after re-auth');
        const retry = await spawnClaude(prompt, cwd, { ...opts, useApiKey: false });
        if (retry.ok) return;
        throw new Error(`claude (subscription retry) failed: ${retry.stderr.slice(0, 300)}`);
      }

      // decision === 'use-api-key' — fall through to API key path below

    } else if (errorType === 'rate-limit') {
      const outcome = await handleRateLimitFailure(
        label, result.stderr, result.stdout,
        () => spawnClaude(prompt, cwd, { ...opts, useApiKey: false }),
      );
      if (outcome === 'ok') return;
      // outcome === 'use-api-key' — fall through

    } else {
      throw new Error(`claude (subscription) failed: ${result.stderr.slice(0, 300)}`);
    }

    logger.info('claude-runner: retrying with API key billing');
    const fallback = await spawnClaude(prompt, cwd, { ...opts, useApiKey: true });
    if (!fallback.ok) throw new Error(`claude (api fallback) failed: ${fallback.stderr.slice(0, 300)}`);
    return;
  }

  const result = await spawnClaude(prompt, cwd, { ...opts, useApiKey: true });
  if (!result.ok) throw new Error(`claude failed: ${result.stderr.slice(0, 300)}`);
}

module.exports = { runClaude };
