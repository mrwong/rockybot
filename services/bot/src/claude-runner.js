'use strict';

const { spawn } = require('child_process');
const { notifyAuthExpired } = require('./notifier');
const discordBot = require('./discord-bot');
const { startLogin } = require('./login-runner');
const logger = require('./logger');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const SUBSCRIPTION_MODE = (process.env.CLAUDE_SUBSCRIPTION_MODE || '').toLowerCase() === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';

const AUTH_PATTERNS       = ['unauthenticated', 'not logged in', 'login required', '401', 'unauthorized', 'authentication failed', 'invalid credentials', 'oauth', 'configuration file not found', 'not authenticated'];
const RATE_LIMIT_PATTERNS = ['rate limit', 'quota exceeded', 'overloaded', '529', 'usage limit', 'too many requests'];

function classifyStderr(stderr) {
  const s = stderr.toLowerCase();
  if (AUTH_PATTERNS.some(p => s.includes(p)))       return 'auth';
  if (RATE_LIMIT_PATTERNS.some(p => s.includes(p))) return 'rate-limit';
  return 'other';
}

// Spawns claude, streaming stdout/stderr to process output.
// Resolves with { ok, stderr } rather than rejecting so the caller can
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
    let stdoutLen = 0;
    proc.stdout.on('data', chunk => { process.stdout.write(chunk); stdoutLen += chunk.length; });
    proc.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      stderrBuf += chunk.toString();
    });
    proc.on('error', reject);
    // Claude exits 0 but produces no stdout when auth fails silently (expired session,
    // missing config) — treat empty stdout as a failure so the caller can fall back.
    proc.on('close', code => resolve({ ok: code === 0 && stdoutLen > 0, stderr: stderrBuf }));
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

// Invokes claude, trying subscription billing first when CLAUDE_SUBSCRIPTION_MODE=true.
// On auth error: enters interactive Discord flow (if enabled) or falls back automatically.
// On rate-limit error: falls back to ANTHROPIC_API_KEY billing silently.
// When DRY_RUN=true, logs the call parameters and returns without running Claude.
//
// label (optional) — human-readable task name shown in Discord auth prompts.
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

    const errorType = classifyStderr(result.stderr);
    if (errorType === 'auth' || result.stderr.trim().length === 0) {
      if (result.stderr.trim().length === 0) {
        // Claude exited silently (code 0, no stdout, no stderr) — likely session expired or
        // config not found. Log a warning before handling so this is visible in the logs.
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
      logger.warn('claude-runner: subscription rate-limit hit — falling back to API key');
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
