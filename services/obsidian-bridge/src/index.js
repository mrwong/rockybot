'use strict';

// Ensure files written to vault/quartz-output are world-readable (nginx reads them)
process.umask(0o022);

const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const logger = require('./logger');
const { scheduleRebuild, runBuild } = require('./quartz-builder');
const { createExportServer } = require('./http-server');

const VAULT_PATH    = process.env.VAULT_PATH    || '/vault';
const QUARTZ_OUTPUT = process.env.QUARTZ_OUTPUT || '/quartz-output';
const QUARTZ_SRC    = '/quartz-src';

function configureQuartz() {
  const configPath = path.join(QUARTZ_SRC, 'quartz.config.ts');
  if (!fs.existsSync(configPath)) {
    logger.warn('quartz.config.ts not found — skipping baseUrl config');
    return;
  }
  let config = fs.readFileSync(configPath, 'utf8');
  const domain = process.env.DOMAIN_NAME || 'localhost';
  config = config.replace(
    /baseUrl:\s*["'][^"']*["']/,
    `baseUrl: "notes.${domain}"`
  );
  // Ensure .obsidian is ignored
  if (!config.includes('.obsidian')) {
    config = config.replace(
      /ignorePatterns:\s*\[/,
      'ignorePatterns: [".obsidian", "tasks/pending", "tasks/done", '
    );
  }
  fs.writeFileSync(configPath, config, 'utf8');
  logger.info('quartz.config.ts updated');

  // Patch layout: make explorer folder titles link to the folder index page.
  // Without this, Quartz places index.md as a root-level leaf (not inside the folder)
  // because simplifySlug strips /index, making "topic/index" → "topic" at root level.
  const layoutPath = path.join(QUARTZ_SRC, 'quartz.layout.ts');
  if (fs.existsSync(layoutPath)) {
    let layout = fs.readFileSync(layoutPath, 'utf8');
    layout = layout.replace(/Component\.Explorer\(\)/g, 'Component.Explorer({ folderClickBehavior: "link" })');
    fs.writeFileSync(layoutPath, layout, 'utf8');
    logger.info('quartz.layout.ts updated (Explorer folderClickBehavior: link)');
  }
}

async function main() {
  logger.info('obsidian-bridge starting');

  configureQuartz();

  await fs.ensureDir(VAULT_PATH);
  await fs.ensureDir(QUARTZ_OUTPUT);

  createExportServer(3001, QUARTZ_OUTPUT, VAULT_PATH);
  logger.info('Export server listening on :3001');

  // Initial build from whatever is already in the vault
  runBuild(VAULT_PATH, QUARTZ_OUTPUT);

  const watcher = chokidar.watch(VAULT_PATH, {
    ignored: /(^|[/\\])\.|tasks\/(pending|done)/,
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 5000,
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 1000 },
  });

  watcher.on('all', (event, filePath) => {
    if (!filePath.endsWith('.md')) return;
    scheduleRebuild(VAULT_PATH, QUARTZ_OUTPUT);
  });

  logger.info(`Watching ${VAULT_PATH} for changes`);
}

main().catch(err => {
  logger.error('Fatal error', err.message);
  process.exit(1);
});
