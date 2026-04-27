'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const logger = require('./logger');
const { runClaude } = require('./claude-runner');
const { notify }    = require('./notifier');

const VAULT_PATH    = process.env.VAULT_PATH || '/vault';
const RESEARCH_PATH = path.join(VAULT_PATH, 'research');
const BUDGET        = process.env.REVISE_BUDGET_USD || '4.00';
const MODEL         = process.env.REVISE_MODEL || 'sonnet';

// Revise tasks read and rewrite multiple existing pages — needs full tool access
const TOOLS = 'Edit,Read,Write,Glob,Grep,WebSearch,WebFetch';

// Prompt files that contain [!revise] as example text — never process them
const EXCLUDED_NAMES = new Set(['revise-prompt.md', 'expand-prompt.md', 'amend-prompt.md', 'research-prompt.md']);

// ---- Prompt loading ---------------------------------------------------------

function extractPrompt(raw) {
  const afterFm = raw.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/, '');
  const sep = afterFm.indexOf('\n---\n');
  return (sep >= 0 ? afterFm.slice(sep + 5) : afterFm).trimStart();
}

async function loadPrompt() {
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/revise-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('revise-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Discovery --------------------------------------------------------------

async function findReviseFiles() {
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
      if (/^>\s*\[!revise\]/m.test(content)) results.push(file);
    } catch { /* skip unreadable files */ }
  }
  return results;
}

// ---- Core processing --------------------------------------------------------

async function reviseFile(targetFile) {
  const relPath = path.relative(VAULT_PATH, targetFile);
  logger.info(`Revising section from ${relPath}`);

  const template = await loadPrompt();
  const prompt = template
    .replace(/\{\{FILE_PATH\}\}/g, targetFile)
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH);

  try {
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET, tools: TOOLS, model: MODEL });
    logger.info(`Revise complete for ${relPath}`);
    await notify({ watcher: 'revise', label: relPath, status: 'success' });
  } catch (err) {
    logger.error(`Claude failed for ${relPath}:`, err.message);
    await notify({ watcher: 'revise', label: relPath, status: 'error', error: err.message });
  }
}

// ---- Public scan ------------------------------------------------------------

async function scanRevisions() {
  let files;
  try {
    files = await findReviseFiles();
  } catch (err) {
    logger.error('Failed to scan for revise blocks:', err.message);
    return;
  }

  if (files.length === 0) {
    logger.info('No [!revise] markers found');
    return;
  }

  for (const file of files) {
    try {
      await reviseFile(file);
    } catch (err) {
      logger.error(`Failed to revise ${file}:`, err.message);
    }
  }
}

// ---- Built-in fallback prompt -----------------------------------------------

const BUILTIN_PROMPT = `\
You are editing a research wiki. The file at {{FILE_PATH}} contains a > [!revise] callout block.
This is a corpus-revision directive: read the instruction text after the callout, find all
[[wikilink]] sub-pages referenced in the file, then revise each sub-page to reflect the
new context described in the instruction. Edit existing files in-place; do not create new pages.
Remove the [!revise] callout from {{FILE_PATH}} when done and update all touched files'
updated: frontmatter to today's date.

See the full prompt at {{VAULT_PATH}}/research/revise-prompt.md once it is seeded.

File to process: {{FILE_PATH}}
`;

module.exports = { scanRevisions };
