'use strict';

const fs   = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const SCAFFOLD_DIR = process.env._TEST_SCAFFOLD_DIR || '/vault-scaffold';
const PROMPT_PATTERN = /-prompt\.md$/;
const BACKUP_REL = 'research/.prompts-backup';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Seed the vault on startup.
//
// Two policies, by filename:
// - *-prompt.md  → bot-controlled. Overwrite from scaffold if content differs;
//                  back up the live copy to research/.prompts-backup/ first.
// - everything else → user-owned. Copy from scaffold only if missing.
async function seedVault(vaultPath) {
  if (!await fs.pathExists(SCAFFOLD_DIR)) {
    logger.warn(`seeder: scaffold dir ${SCAFFOLD_DIR} not found — skipping`);
    return;
  }

  const backupDir = path.join(vaultPath, BACKUP_REL);

  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath  = path.join(dir, entry.name);
      const relPath  = path.relative(SCAFFOLD_DIR, srcPath);
      const destPath = path.join(vaultPath, relPath);

      if (entry.isDirectory()) {
        await fs.ensureDir(destPath);
        await walk(srcPath);
        continue;
      }

      if (!entry.name.endsWith('.md')) continue;

      const destExists = await fs.pathExists(destPath);

      if (!destExists) {
        await fs.copy(srcPath, destPath);
        logger.info(`seeder: seeded ${relPath}`);
        continue;
      }

      // Existing file. User-owned files are never overwritten.
      if (!PROMPT_PATTERN.test(entry.name)) continue;

      // Prompt file — compare and replace if drifted.
      const [src, dest] = await Promise.all([
        fs.readFile(srcPath, 'utf8'),
        fs.readFile(destPath, 'utf8'),
      ]);
      if (src === dest) continue;

      await fs.ensureDir(backupDir);
      const backupName = `${path.basename(entry.name, '.md')}-${timestamp()}.md`;
      const backupPath = path.join(backupDir, backupName);
      await fs.copy(destPath, backupPath);
      await fs.copy(srcPath, destPath, { overwrite: true });
      logger.info(`seeder: updated ${relPath} (previous saved as ${path.join(BACKUP_REL, backupName)})`);
    }
  };

  logger.info(`seeder: seeding vault scaffold into ${vaultPath}`);
  await walk(SCAFFOLD_DIR);
  logger.info('seeder: done');
}

module.exports = { seedVault };
