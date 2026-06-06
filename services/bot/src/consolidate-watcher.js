'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const logger = require('./logger');
const { runClaude } = require('./claude-runner');
const { notify }    = require('./notifier');

const VAULT_PATH    = process.env.VAULT_PATH || '/vault';
const RESEARCH_PATH = path.join(VAULT_PATH, 'research');
const BUDGET        = process.env.CONSOLIDATE_BUDGET_USD || '4.00';
const MODEL         = process.env.CONSOLIDATE_MODEL || 'sonnet';

// Consolidate tasks read/move files across the whole vault — needs full tool access
const TOOLS = 'Edit,Read,Write,Glob,Grep,Bash';

// Prompt files that contain [!consolidate] as example text — never process them
const EXCLUDED_NAMES = new Set([
  'consolidate-prompt.md', 'revise-prompt.md', 'expand-prompt.md',
  'amend-prompt.md', 'research-prompt.md',
]);

// ---- Prompt loading ---------------------------------------------------------

function extractPrompt(raw) {
  const afterFm = raw.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/, '');
  const sep = afterFm.indexOf('\n---\n');
  return (sep >= 0 ? afterFm.slice(sep + 5) : afterFm).trimStart();
}

async function loadPrompt() {
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/consolidate-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('consolidate-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Discovery --------------------------------------------------------------

async function findConsolidateFiles() {
  const files = await glob('**/*.md', {
    cwd: RESEARCH_PATH,
    ignore: ['inbox/**', 'processed/**'],
    absolute: true,
  });

  const results = [];
  for (const file of files) {
    if (EXCLUDED_NAMES.has(path.basename(file))) continue;
    try {
      const content = await fs.readFile(file, 'utf8');
      if (/^>\s*\[!consolidate\]/m.test(content)) results.push(file);
    } catch { /* skip unreadable files */ }
  }
  return results;
}

// ---- Core processing --------------------------------------------------------

async function consolidateFile(targetFile) {
  const relPath = path.relative(VAULT_PATH, targetFile);
  logger.info(`Consolidating from ${relPath}`);

  const template = await loadPrompt();
  const prompt = template
    .replace(/\{\{FILE_PATH\}\}/g, targetFile)
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH);

  try {
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET, tools: TOOLS, model: MODEL });
    logger.info(`Consolidate complete for ${relPath}`);
    await notify({ watcher: 'consolidate', label: relPath, status: 'success' });
  } catch (err) {
    logger.error(`Claude failed for ${relPath}:`, err.message);
    await notify({ watcher: 'consolidate', label: relPath, status: 'error', error: err.message });
  }
}

// ---- Public scan ------------------------------------------------------------

async function scanConsolidations() {
  let files;
  try {
    files = await findConsolidateFiles();
  } catch (err) {
    logger.error('Failed to scan for consolidate blocks:', err.message);
    return;
  }

  if (files.length === 0) {
    logger.info('No [!consolidate] markers found');
    return;
  }

  for (const file of files) {
    try {
      await consolidateFile(file);
    } catch (err) {
      logger.error(`Failed to consolidate ${file}:`, err.message);
    }
  }
}

// ---- Built-in fallback prompt -----------------------------------------------

const BUILTIN_PROMPT = `\
You are maintaining a personal research wiki. The file at {{FILE_PATH}} contains a > [!consolidate] callout block.

This is a **topic consolidation directive**: read the instruction text after the callout, then merge the
source topic(s) listed into this target topic. Move relevant content, update all wikilinks, and archive
the source topic folder(s) when done.

Remove the [!consolidate] callout from {{FILE_PATH}} when done and update all touched files'
updated: frontmatter to today's date.

See the full prompt at {{VAULT_PATH}}/research/consolidate-prompt.md once it is seeded.

File to process: {{FILE_PATH}}
`;

module.exports = { scanConsolidations };
