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
const { scanRevisions }  = require('./revise-watcher');
const { scanLint }       = require('./lint-watcher');

const INBOX_POLL_MS = (parseInt(process.env.INBOX_POLL_SECONDS || '600')) * 1000;

// Global mutex — only one Claude invocation at a time across all watchers.
// Lint, inbox, and amend all write to the same vault; concurrent runs would
// race against each other with no benefit (API budget is the bottleneck, not
// parallelism).
let globalRunning = false;

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
  await withGlobalLock('inbox',  scanInbox);
  await withGlobalLock('amend',  scanAmendments);
  await withGlobalLock('expand', scanExpands);
  await withGlobalLock('revise', scanRevisions);
  await withGlobalLock('lint',   scanLint);
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
  });

  await seedVault(vaultPath);

  if (discordBot.isEnabled()) {
    await discordBot.broadcastStartup(version);
  } else {
    await notifier.notifyStartup(version);
  }

  if (isHoldActive()) {
    logger.warn('research-gate: hold is ACTIVE on startup — inbox will not process until released');
  }

  await pollAll();
  setInterval(pollAll, INBOX_POLL_MS);
}

main().catch(err => {
  logger.error('Fatal:', err.message);
  process.exit(1);
});
