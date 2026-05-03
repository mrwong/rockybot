'use strict';

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const { runClaude }  = require('./claude-runner');
const notifier       = require('./notifier');
const discordBot     = require('./discord-bot');
const researchGate   = require('./research-gate');

const VAULT_PATH = process.env.VAULT_PATH || '/vault';
const INBOX     = path.join(VAULT_PATH, 'research/inbox');
const PROCESSED = path.join(VAULT_PATH, 'research/processed');
const BUDGET    = process.env.RESEARCH_BUDGET_USD || '2.00';

// ---- Frontmatter helpers ----------------------------------------------------

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
  // Strip YAML frontmatter + human-readable preamble (ends at the first --- rule
  // after the frontmatter block). Falls back to the full file if no rule found.
  const afterFm = raw.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/, '');
  const sep = afterFm.indexOf('\n---\n');
  return (sep >= 0 ? afterFm.slice(sep + 5) : afterFm).trimStart();
}

async function loadPrompt() {
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/research-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('research-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Core processing --------------------------------------------------------

async function processFile(seedFile) {
  const filename = path.basename(seedFile);
  logger.info(`Processing ${filename}`);

  // Update status and move to processed/ BEFORE running Claude so LiveSync
  // cannot conflict-overwrite status changes mid-run.
  let content = await fs.readFile(seedFile, 'utf8');
  content = setFrontmatterField(content, 'status', 'processing');
  await fs.writeFile(seedFile, content, 'utf8');

  const processingFile = path.join(PROCESSED, filename);
  await fs.move(seedFile, processingFile, { overwrite: false });

  // Build prompt
  const template = await loadPrompt();
  const seedContents = await fs.readFile(processingFile, 'utf8');
  const prompt = template
    .replace(/\{\{SEED_PATH\}\}/g, processingFile)
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH)
    .replace('{{SEED_CONTENTS}}', seedContents);

  try {
    logger.info(`Invoking Claude for ${filename}`);
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET });
    logger.info(`Claude completed for ${filename}`);
  } catch (err) {
    logger.error(`Claude failed for ${filename}: ${err.message}`);
    await notifier.notify({ watcher: 'research', label: filename, status: 'error', error: err.message });
    let fc = await fs.readFile(processingFile, 'utf8');
    fc = setFrontmatterField(fc, 'status', 'error');
    const timestamp = new Date().toISOString();
    fc += `\n\n---\n\n> [!error] Research failed (${timestamp})\n> ${err.message.replace(/\n/g, '\n> ')}\n>\n> Change \`status\` back to \`pending\` to retry.\n`;
    await fs.writeFile(processingFile, fc, 'utf8');
    await fs.move(processingFile, seedFile, { overwrite: true });
    return;
  }

  const finalContent = await fs.readFile(processingFile, 'utf8');
  const finalStatus  = getFrontmatterField(finalContent, 'status');

  if (finalStatus === 'completed') {
    logger.info(`Research complete for ${filename} — stays in processed/`);
    await notifier.notify({ watcher: 'research', label: filename, status: 'success' });
  } else if (finalStatus === 'awaiting-input') {
    logger.info(`Clarification needed for ${filename} — moving back to inbox`);
    await fs.move(processingFile, seedFile, { overwrite: true });
  } else {
    logger.warn(`Unexpected status '${finalStatus}' for ${filename} — moving back to inbox`);
    await fs.move(processingFile, seedFile, { overwrite: true });
  }
}

// ---- Public: mark an inbox item for immediate processing --------------------

async function expediteItem(filename) {
  const seedFile = path.join(INBOX, filename);
  let content;
  try {
    content = await fs.readFile(seedFile, 'utf8');
  } catch {
    logger.warn(`expediteItem: ${filename} not found in inbox`);
    return;
  }
  content = setFrontmatterField(content, 'status', 'expedited');
  await fs.writeFile(seedFile, content, 'utf8');
  logger.info(`expediteItem: ${filename} marked as expedited`);
}

// ---- Public scan ------------------------------------------------------------

async function scanInbox() {
  await fs.ensureDir(INBOX);
  await fs.ensureDir(PROCESSED);

  let entries;
  try {
    entries = await fs.readdir(INBOX);
  } catch (err) {
    logger.error('Failed to read inbox:', err.message);
    return;
  }

  const expeditedFiles = [];
  const pendingFiles   = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    if (entry === 'example-research-request.md') continue;

    const seedFile = path.join(INBOX, entry);
    let content;
    try { content = await fs.readFile(seedFile, 'utf8'); } catch { continue; }

    if (!content.includes('research-request')) continue;

    let status = getFrontmatterField(content, 'status');

    // 'processing' in inbox/ means the watcher crashed after writing the status
    // but before the fs.move() completed. Reset to pending and recover.
    if (status && status.toLowerCase() === 'processing') {
      logger.warn(`${entry}: found stuck 'processing' in inbox — resetting to pending`);
      content = setFrontmatterField(content, 'status', 'pending');
      await fs.writeFile(seedFile, content, 'utf8');
      status = 'pending';
    }

    if (!status) continue;
    const s = status.toLowerCase();
    if (s === 'expedited')    expeditedFiles.push(seedFile);
    else if (s === 'pending') pendingFiles.push(seedFile);
  }

  // Always process expedited items regardless of gate state
  for (const file of expeditedFiles) {
    try {
      await processFile(file);
      researchGate.recordResearchCompletion();
    } catch (err) {
      logger.error(`Failed to process ${path.basename(file)}:`, err.message);
    }
  }

  // Gate check for pending items
  const gateReason = researchGate.researchGateReason();

  if (gateReason === 'quiet_hours') {
    if (pendingFiles.length > 0) {
      const newItems = pendingFiles.filter(f => !researchGate.isItemNotified(path.basename(f)));
      for (const file of newItems) {
        researchGate.markItemNotified(path.basename(file));
        if (discordBot.isEnabled()) {
          await discordBot.notifyQuietHoursItem(path.basename(file));
        } else {
          await notifier.notifyQuietHoursItemWebhook(path.basename(file));
        }
      }
      logger.info(`${pendingFiles.length} pending research item(s) held — quiet hours`);
    }
  } else if (gateReason) {
    if (pendingFiles.length > 0) {
      logger.info(`${pendingFiles.length} pending research item(s) held — ${gateReason}`);
    }
  } else {
    researchGate.clearNotifiedItems();
    for (const file of pendingFiles) {
      try {
        await processFile(file);
        researchGate.recordResearchCompletion();
      } catch (err) {
        logger.error(`Failed to process ${path.basename(file)}:`, err.message);
      }
    }
  }

  if (expeditedFiles.length === 0 && pendingFiles.length === 0) {
    logger.info('No pending research requests');
  }
}

// ---- Built-in fallback prompt (used if vault copy is missing) ---------------

const BUILTIN_PROMPT = `\
You are a research assistant building structured notes for a personal knowledge base wiki.

A research request has been filed. The seed note path and contents are provided below.

Vault root: {{VAULT_PATH}}

Your task: read the seed note, research the topic using WebSearch and WebFetch, build
structured cross-linked pages in research/<topic-slug>/, update research/index.md and
research/journal.md, then set status: completed in the seed note.

See the full prompt at {{VAULT_PATH}}/research/research-prompt.md once it is seeded.

SEED_PATH: {{SEED_PATH}}

\`\`\`
{{SEED_CONTENTS}}
\`\`\`
`;

module.exports = { scanInbox, expediteItem };
