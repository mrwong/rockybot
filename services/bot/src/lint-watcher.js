'use strict';

const fs   = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const { runClaude } = require('./claude-runner');
const { notify }    = require('./notifier');

const VAULT_PATH    = process.env.VAULT_PATH    || '/vault';
const TRIGGER_FILE  = path.join(VAULT_PATH, 'research/lint-trigger.md');
const BUDGET        = process.env.LINT_BUDGET_USD || '5.00';
const MODEL         = process.env.LINT_MODEL || 'sonnet';

// Lint is a read-and-fix pass — no web access or shell needed
const TOOLS = 'Edit,Read,Write,Glob,Grep';

// ---- Frontmatter helpers (same as inbox-watcher) ----------------------------

function getFrontmatterField(content, field) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const line = m[1].split('\n').find(l => l.startsWith(`${field}:`));
  if (!line) return null;
  return line.replace(`${field}:`, '').trim().replace(/^['"]|['"]$/g, '');
}

function setFrontmatterField(content, field, value) {
  if (new RegExp(`^${field}:`, 'm').test(content)) {
    return content.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);
  }
  return content.replace(/^(---\r?\n)/, `$1${field}: ${value}\n`);
}

// ---- Prompt loading ---------------------------------------------------------

function extractPrompt(raw) {
  const afterFm = raw.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/, '');
  const sep = afterFm.indexOf('\n---\n');
  return (sep >= 0 ? afterFm.slice(sep + 5) : afterFm).trimStart();
}

async function loadPrompt() {
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/lint-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('lint-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Core processing --------------------------------------------------------

async function runLint() {
  // Check trigger file exists and is pending
  let content;
  try {
    content = await fs.readFile(TRIGGER_FILE, 'utf8');
  } catch {
    return; // No trigger file — nothing to do
  }

  const status = getFrontmatterField(content, 'status');
  if (!status || status.toLowerCase() !== 'pending') return;

  logger.info('Lint pass triggered');

  // Mark as processing
  content = setFrontmatterField(content, 'status', 'processing');
  content = setFrontmatterField(content, 'started', new Date().toISOString().slice(0, 10));
  await fs.writeFile(TRIGGER_FILE, content, 'utf8');

  const template = await loadPrompt();
  const prompt = template
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH)
    .replace(/\{\{TRIGGER_FILE\}\}/g, TRIGGER_FILE);

  try {
    logger.info('Invoking Claude for lint pass');
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET, tools: TOOLS, model: MODEL });
    logger.info('Lint pass complete');
    await notify({ watcher: 'lint', label: 'lint pass', status: 'success' });
  } catch (err) {
    logger.error(`Lint pass failed: ${err.message}`);
    await notify({ watcher: 'lint', label: 'lint pass', status: 'error', error: err.message });
    let fc = await fs.readFile(TRIGGER_FILE, 'utf8');
    fc = setFrontmatterField(fc, 'status', 'error');
    await fs.writeFile(TRIGGER_FILE, fc, 'utf8');
  }
}

// ---- Public scan ------------------------------------------------------------

async function scanLint() {
  try {
    await runLint();
  } catch (err) {
    logger.error('Lint scan threw:', err.message);
  }
}

// ---- Built-in fallback prompt -----------------------------------------------

const BUILTIN_PROMPT = `\
You are performing a lint pass on a personal knowledge base wiki built with the Karpathy LLM Wiki pattern.

Vault root: {{VAULT_PATH}}
Trigger file: {{TRIGGER_FILE}}

Your task: audit the research wiki for structural health issues, fix what you can directly,
and write a report to {{VAULT_PATH}}/research/lint-report.md.

See the full prompt at {{VAULT_PATH}}/research/lint-prompt.md once it is seeded.

When done, set status: completed and completed: <today's date> in {{TRIGGER_FILE}}.
`;

module.exports = { scanLint };
