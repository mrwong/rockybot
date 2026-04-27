'use strict';

const fs   = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const SCAFFOLD_DIR = '/vault-scaffold';

// Copies scaffold files into the vault on startup.
// Only copies files that don't already exist — user edits are never overwritten.
async function seedVault(vaultPath) {
  if (!await fs.pathExists(SCAFFOLD_DIR)) {
    logger.warn(`seeder: scaffold dir ${SCAFFOLD_DIR} not found — skipping`);
    return;
  }

  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath  = path.join(dir, entry.name);
      const relPath  = path.relative(SCAFFOLD_DIR, srcPath);
      const destPath = path.join(vaultPath, relPath);
      if (entry.isDirectory()) {
        await fs.ensureDir(destPath);
        await walk(srcPath);
      } else if (entry.name.endsWith('.md')) {
        if (!await fs.pathExists(destPath)) {
          await fs.copy(srcPath, destPath);
          logger.info(`seeder: seeded ${relPath}`);
        }
      }
    }
  };

  logger.info(`seeder: seeding vault scaffold into ${vaultPath}`);
  await walk(SCAFFOLD_DIR);
  logger.info('seeder: done');
}

module.exports = { seedVault };
