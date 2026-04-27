'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const logger = require('./logger');
const { runClaude } = require('./claude-runner');
const { notify }    = require('./notifier');

const VAULT_PATH    = process.env.VAULT_PATH || '/vault';
const RESEARCH_PATH = path.join(VAULT_PATH, 'research');
const BUDGET        = process.env.EXPAND_BUDGET_USD || '1.00';
const MODEL         = process.env.EXPAND_MODEL || 'sonnet';

// Expand tasks create new sub-pages, which often requires web research
const TOOLS = 'Edit,Read,Write,Glob,Grep,WebSearch,WebFetch';

// Prompt files that contain [!expand] as example text — never process them
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
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/expand-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('expand-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Discovery --------------------------------------------------------------

async function findExpandFiles() {
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
      if (/^>\s*\[!expand\]/m.test(content)) results.push(file);
    } catch { /* skip unreadable files */ }
  }
  return results;
}

// ---- Core processing --------------------------------------------------------

async function expandFile(targetFile) {
  const relPath = path.relative(VAULT_PATH, targetFile);
  logger.info(`Expanding ${relPath}`);

  const template = await loadPrompt();
  const prompt = template
    .replace(/\{\{FILE_PATH\}\}/g, targetFile)
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH);

  try {
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET, tools: TOOLS, model: MODEL });
    logger.info(`Expand complete for ${relPath}`);
    await notify({ watcher: 'expand', label: relPath, status: 'success' });
  } catch (err) {
    logger.error(`Claude failed for ${relPath}:`, err.message);
    await notify({ watcher: 'expand', label: relPath, status: 'error', error: err.message });
  }
}

// ---- Public scan ------------------------------------------------------------

async function scanExpands() {
  let files;
  try {
    files = await findExpandFiles();
  } catch (err) {
    logger.error('Failed to scan for expand blocks:', err.message);
    return;
  }

  if (files.length === 0) {
    logger.info('No [!expand] markers found');
    return;
  }

  for (const file of files) {
    try {
      await expandFile(file);
    } catch (err) {
      logger.error(`Failed to expand ${file}:`, err.message);
    }
  }
}

// ---- Built-in fallback prompt -----------------------------------------------

const BUILTIN_PROMPT = `\
You are editing a research note and creating new sub-pages in a personal knowledge base wiki.

The file at {{FILE_PATH}} contains one or more > [!expand] callout blocks.
Each callout is a request to create a new dedicated sub-page on the topic described
in the text immediately following the callout block.

See the full prompt at {{VAULT_PATH}}/research/expand-prompt.md once it is seeded.

File to process: {{FILE_PATH}}
`;

module.exports = { scanExpands };
