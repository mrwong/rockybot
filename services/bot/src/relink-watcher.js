'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');
const { runClaude } = require('./claude-runner');
const { notify }    = require('./notifier');

const VAULT_PATH    = process.env.VAULT_PATH || '/vault';
const RESEARCH_PATH = path.join(VAULT_PATH, 'research');
const SHAPE_FILE    = path.join(RESEARCH_PATH, 'wiki-shape.json');
const BUDGET        = process.env.RELINK_BUDGET_USD || '2.00';
const MODEL         = process.env.RELINK_MODEL || 'haiku';
const TOOLS         = 'Edit,Read,Write,Glob,Grep,Bash';
const SKIP_DIRS     = new Set(['inbox', 'processed', '.trash']);

// ---- Prompt loading ---------------------------------------------------------

function extractPrompt(raw) {
  const afterFm = raw.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/, '');
  const sep = afterFm.indexOf('\n---\n');
  return (sep >= 0 ? afterFm.slice(sep + 5) : afterFm).trimStart();
}

async function loadPrompt() {
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, 'research/relink-prompt.md'), 'utf8');
    return extractPrompt(raw);
  } catch {
    logger.warn('relink-prompt.md not found in vault — using built-in default');
    return BUILTIN_PROMPT;
  }
}

// ---- Shape scanning ---------------------------------------------------------

function scanTopics(dir, prefix) {
  const topics = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return topics;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const indexPath = path.join(dir, entry.name, 'index.md');
    if (fs.existsSync(indexPath)) topics.push(relPath);
    topics.push(...scanTopics(path.join(dir, entry.name), relPath));
  }
  return topics;
}

// ---- Move detection ---------------------------------------------------------

function diffTopics(oldTopics, newTopics) {
  const newSet  = new Set(newTopics);
  const removed = oldTopics.filter(t => !newSet.has(t));
  const added   = newTopics.filter(t => !new Set(oldTopics).has(t));

  const moves = [];
  const usedAdded = new Set();

  for (const from of removed) {
    const basename = from.split('/').pop();
    const match = added.find(a => !usedAdded.has(a) && a.split('/').pop() === basename);
    if (match) {
      moves.push({ from, to: match });
      usedAdded.add(match);
    }
  }
  return { moves };
}

// ---- Affected file discovery ------------------------------------------------

function findAffectedFiles(moves) {
  const affected = new Set();
  for (const { from } of moves) {
    try {
      const result = execSync(
        `grep -rl "research/${from}" "${VAULT_PATH}" --include="*.md"`,
        { encoding: 'utf8' }
      ).trim();
      if (result) result.split('\n').forEach(f => affected.add(f));
    } catch {
      // grep exits 1 when no matches — that's fine
    }
  }
  return [...affected];
}

// ---- Core processing --------------------------------------------------------

async function relinkMoves(moves) {
  const affectedFiles = findAffectedFiles(moves);

  const movesText = moves.map(({ from, to }) => `  ${from} → ${to}`).join('\n');
  const filesText = affectedFiles.length > 0
    ? affectedFiles.join('\n')
    : '(none — Obsidian wikilinks already updated, only frontmatter gardening needed)';

  const template = await loadPrompt();
  const prompt = template
    .replace(/\{\{VAULT_PATH\}\}/g, VAULT_PATH)
    .replace(/\{\{MOVES\}\}/g, movesText)
    .replace(/\{\{AFFECTED_FILES\}\}/g, filesText);

  const label = moves.map(({ from, to }) => `${from} → ${to}`).join(', ');
  try {
    await runClaude(prompt, VAULT_PATH, { budgetUsd: BUDGET, tools: TOOLS, model: MODEL });
    logger.info(`relink: complete for ${label}`);
    await notify({ watcher: 'relink', label, status: 'success' });
  } catch (err) {
    logger.error(`relink: Claude failed: ${err.message}`);
    await notify({ watcher: 'relink', label, status: 'error', error: err.message });
  }
}

// ---- Public scan ------------------------------------------------------------

async function scanRelinks() {
  if (!fs.existsSync(RESEARCH_PATH)) return;

  const currentTopics = scanTopics(RESEARCH_PATH, '');
  let previousTopics  = [];

  if (await fs.pathExists(SHAPE_FILE)) {
    try {
      previousTopics = (await fs.readJson(SHAPE_FILE)).topics || [];
    } catch {
      logger.warn('relink: wiki-shape.json unreadable — treating as first run');
    }
  }

  const { moves } = diffTopics(previousTopics, currentTopics);

  await fs.outputJson(
    SHAPE_FILE,
    { generated: new Date().toISOString(), topics: currentTopics },
    { spaces: 2 }
  );

  if (moves.length === 0) {
    logger.info('relink: no topic moves detected');
    return;
  }

  logger.info(`relink: detected ${moves.length} move(s) — invoking Claude`);
  await relinkMoves(moves);
}

// ---- Built-in fallback prompt -----------------------------------------------

const BUILTIN_PROMPT = `\
You are maintaining a personal research wiki stored in an Obsidian vault at {{VAULT_PATH}}.

Topic folders were moved to new locations within the vault. Obsidian has already updated
all [[wikilinks]] automatically. Your job is to fix prose references and garden frontmatter.

**Moved topics:**
{{MOVES}}

**Files that contain references to the old paths** (check these for prose fixes):
{{AFFECTED_FILES}}

## Your tasks

1. **Fix prose references** — Read each file listed above. Look for sentences or phrases
   that describe the old location by name (e.g. "see the Hobbies section", "in the AI research
   bucket", "the family area covers..."). Update the prose to reflect the new location.
   Do not change wikilinks — Obsidian already handled those.

2. **Garden frontmatter on moved topics** — For every index.md file inside the moved topic
   directories (at {{VAULT_PATH}}/research/<new-path>/), ensure:
   - \`para:\` is set to the correct bucket derived from the new path prefix
     (first segment after research/ → projects, areas, resources, or archive)
   - \`updated:\` is set to today's date (YYYY-MM-DD format)

3. **Update \`updated:\` on prose-fixed files** — For any file where you changed prose,
   also update its \`updated:\` frontmatter field to today's date.

4. **Report** — After finishing, briefly list what you changed.

Be conservative — only change what is clearly stale or incorrect. Do not rewrite content.
`;

module.exports = { scanRelinks, scanTopics, diffTopics };
