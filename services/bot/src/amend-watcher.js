'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const logger = require('./logger');
const { runClaude } = require('./claude-runner');
const { notify }    = require('./notifier');

const VAULT_PATH    = process.env.VAULT_PATH || '/vault';
const RESEARCH_PATH = path.join(VAULT_PATH, 'research');
const BUDGET        = process.env.AMEND_BUDGET_USD || '0.50';
const MODEL         = process.env.AMEND_MODEL || 'haiku';

// Amend tasks may need web access for enrichment (adding links, citations)
const TOOLS = 'Edit,Read,Write,Glob,Grep,WebSearch,WebFetch';

// These files contain [!claude] as example text — never process them
const EXCLUDED_NAMES = new Set([
  'amend-prompt.md', 'expand-prompt.md', 'revise-prompt.md', 'lint-prompt.md', 'research-prompt.md',
]);

// ---- Prompt loading ---------------------------------------------------------

function extractPrompt(raw) {
  const afterFm = raw.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/, '');
  const sep = afterFm.indexOf('\n---\n');
  return (sep >= 0 ? afterFm.slice(sep + 5) : afterFm).trimStart();
}

async function loadPrompt() {
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/amend-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('amend-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Discovery --------------------------------------------------------------

async function findAnnotatedFiles() {
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
      if (/^>\s*\[!claude\]/m.test(content)) results.push(file);
    } catch { /* skip unreadable files */ }
  }
  return results;
}

// ---- Core processing --------------------------------------------------------

async function amendFile(targetFile) {
  const relPath = path.relative(VAULT_PATH, targetFile);
  logger.info(`Amending ${relPath}`);

  const template = await loadPrompt();
  const prompt = template
    .replace(/\{\{FILE_PATH\}\}/g, targetFile)
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH);

  try {
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET, tools: TOOLS, model: MODEL });
    logger.info(`Amendment complete for ${relPath}`);
    await notify({ watcher: 'amend', label: relPath, status: 'success' });
  } catch (err) {
    logger.error(`Claude failed for ${relPath}:`, err.message);
    await notify({ watcher: 'amend', label: relPath, status: 'error', error: err.message });
  }
}

// ---- Public scan ------------------------------------------------------------

async function scanAmendments() {
  let files;
  try {
    files = await findAnnotatedFiles();
  } catch (err) {
    logger.error('Failed to scan for amendments:', err.message);
    return;
  }

  if (files.length === 0) {
    logger.info('No [!claude] markers found');
    return;
  }

  for (const file of files) {
    try {
      await amendFile(file);
    } catch (err) {
      logger.error(`Failed to amend ${file}:`, err.message);
    }
  }
}

// ---- Built-in fallback prompt -----------------------------------------------

const BUILTIN_PROMPT = `\
You are editing an existing research note in a personal knowledge base wiki.

The file at {{FILE_PATH}} contains one or more > [!claude] callout blocks.
Each callout is an inline task. Read the file, perform each task, remove the
callout when done, and update the updated: field in frontmatter to today's date.

See the full prompt at {{VAULT_PATH}}/research/amend-prompt.md once it is seeded.

File to amend: {{FILE_PATH}}
`;

module.exports = { scanAmendments };
