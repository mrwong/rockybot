'use strict';

const logger = require('./logger');
const { version }             = require('../package.json');
const discordBot              = require('./discord-bot');
const notifier                = require('./notifier');
const { seedVault }           = require('./seeder');
const { scanInbox, expediteItem } = require('./inbox-watcher');
const { isHoldActive }        = require('./research-gate');
const { scanAmendments }      = require('./amend-watcher');
const { scanExpands }    = require('./expand-watcher');
const { scanRevisions }      = require('./revise-watcher');
const { scanConsolidations } = require('./consolidate-watcher');
const { scanLint }           = require('./lint-watcher');

const INBOX_POLL_MS = (parseInt(process.env.INBOX_POLL_SECONDS || '600')) * 1000;

// Global mutex — only one Claude invocation at a time across all watchers.
// Lint, inbox, and amend all write to the same vault; concurrent runs would
// race against each other with no benefit (API budget is the bottleneck, not
// parallelism).
let globalRunning = false;

// Poller state — exposed to the Discord bot for status display.
let lastPollTime = null;
let nextPollTime = null;
let pollInterval = null;

function getPollerState() {
  return { isRunning: globalRunning, lastPollTime, nextPollTime };
}

// Cancels the current interval and fires pollAll() immediately, then resets
// the interval so the cadence resumes from the trigger point.
function triggerPoll() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  setImmediate(async () => {
    await pollAll();
    nextPollTime = Date.now() + INBOX_POLL_MS;
    pollInterval = setInterval(async () => {
      await pollAll();
      nextPollTime = Date.now() + INBOX_POLL_MS;
    }, INBOX_POLL_MS);
  });
}

async function withGlobalLock(name, fn) {
  if (globalRunning) {
    logger.info(`${name} skipping — another scan is running`);
    return;
  }
  globalRunning = true;
  logger.info(`--- ${name} scan start ---`);
  try {
    await fn();
  } catch (err) {
    logger.error(`${name} scan threw:`, err.message);
  } finally {
    logger.info(`--- ${name} scan end ---`);
    globalRunning = false;
  }
}

// Single poll cycle — runs all watchers in sequence so they never
// compete for the global lock. Separate intervals all firing at the same
// tick would cause inbox to always win and amend/lint/expand to always skip.
async function pollAll() {
  lastPollTime = Date.now();
  await withGlobalLock('inbox',       scanInbox);
  await withGlobalLock('amend',       scanAmendments);
  await withGlobalLock('expand',      scanExpands);
  await withGlobalLock('revise',      scanRevisions);
  await withGlobalLock('consolidate', scanConsolidations);
  await withGlobalLock('lint',        scanLint);
}

async function main() {
  const vaultPath = process.env.VAULT_PATH || '/vault';
  logger.info('rockybot starting');
  logger.info(`vault:         ${vaultPath}`);
  logger.info(`poll interval: every ${INBOX_POLL_MS / 1000}s`);
  if (process.env.DRY_RUN === 'true') logger.info('DRY_RUN=true — watchers will detect but not call Claude');

  await discordBot.init();

  discordBot.setExpediteHandler(async (filename) => {
    await expediteItem(filename);
    await pollAll();
    nextPollTime = Date.now() + INBOX_POLL_MS;
  });
  discordBot.setPollerStateGetter(getPollerState);
  discordBot.setTriggerPoll(triggerPoll);

  await seedVault(vaultPath);

  // Webhook is the reliable path — always fires if DISCORD_WEBHOOK_URL is set,
  // independent of bot gateway state. Bot channel fires in addition if interactive
  // mode is active (covers setups where only a bot token is configured, no webhook).
  await notifier.notifyStartup(version);
  if (discordBot.isEnabled()) {
    await discordBot.broadcastStartup(version);
  }

  if (isHoldActive()) {
    logger.warn('research-gate: hold is ACTIVE on startup — inbox will not process until released');
  }

  await pollAll();
  nextPollTime = Date.now() + INBOX_POLL_MS;
  pollInterval = setInterval(async () => {
    await pollAll();
    nextPollTime = Date.now() + INBOX_POLL_MS;
  }, INBOX_POLL_MS);
}

main().catch(err => {
  logger.error('Fatal:', err.message);
  process.exit(1);
});
