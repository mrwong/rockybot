'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');
const { injectExportUI } = require('./export-ui');

const QUARTZ_SRC = '/quartz-src';
const DEBOUNCE_MS = 3000;

let timer = null;

function scheduleRebuild(vaultPath, quartzOutput) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runBuild(vaultPath, quartzOutput);
  }, DEBOUNCE_MS);
}

function getPublishedTopics(vaultPath) {
  const researchDir = path.join(vaultPath, 'research');
  if (!fs.existsSync(researchDir)) return [];
  const published = [];
  const SKIP_DIRS = new Set(['inbox', 'processed', '.trash']);

  function scanDir(dir, relPrefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const indexPath = path.join(dir, entry.name, 'index.md');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf8');
        const match = content.match(/^publish:\s*(true|false)/m);
        if (match && match[1] === 'true') published.push(relPath);
      }
      scanDir(path.join(dir, entry.name), relPath);
    }
  }

  scanDir(researchDir, '');
  return published;
}

function runBuild(vaultPath, quartzOutput) {
  try {
    const topics = getPublishedTopics(vaultPath);
    if (topics.length === 0) {
      logger.warn('No published topics (publish: true) found — skipping build');
      return;
    }
    logger.info(`Publishing ${topics.length} topic(s): ${topics.join(', ')}`);

    // rsync needs an explicit --include for every path segment before it can
    // traverse into subdirs. For projects/travel/china-vacation-2026 that means
    // include /projects/, /projects/travel/, then /projects/travel/china-vacation-2026/***
    const ancestorIncludes = new Set();
    const topicIncludes = [];
    for (const t of topics) {
      const parts = t.split('/');
      for (let i = 1; i < parts.length; i++) {
        ancestorIncludes.add(`/${parts.slice(0, i).join('/')}/`);
      }
      topicIncludes.push(`--include='/${t}/***'`);
    }
    const includes = [
      ...[...ancestorIncludes].map(p => `--include='${p}'`),
      ...topicIncludes,
    ].join(' ');
    logger.info('Syncing published topics → quartz content dir');
    execSync(
      `rsync -a --delete ${includes} --exclude='*' ${vaultPath}/research/ ${QUARTZ_SRC}/content/`,
      { stdio: 'inherit' }
    );

    // Generate a root index so Quartz produces index.html at the site root.
    // Mirrors the PARA directory shape so deeply nested topics are findable.
    fs.outputFileSync(
      path.join(QUARTZ_SRC, 'content', 'index.md'),
      `---\ntitle: Research\n---\n\n# Research\n\n${renderRootIndex(topics)}\n`
    );

    // Quartz v4.5+ removes the --output directory itself (rmdir) before each
    // build. quartzOutput is a bind-mount whose parent is root-owned, so rmdir
    // on it fails EACCES for our uid (we can write inside it, but not remove
    // it). Build into a container-local staging dir Quartz can freely recreate,
    // then rsync the result into the mounted output dir. Bonus: publishing is
    // now an atomic sync into a populated dir rather than empty-then-rebuild.
    const stageDir = '/tmp/quartz-build';
    logger.info('Running quartz build');
    execSync(`npx quartz build --output ${stageDir}`, {
      cwd: QUARTZ_SRC,
      stdio: 'inherit',
    });
    logger.info('Publishing build → output dir');
    execSync(`rsync -a --delete ${stageDir}/ ${quartzOutput}/`, { stdio: 'inherit' });

    // NFS ACLs strip world-readable bits; restore them so nginx can serve the files
    execSync(`chmod -R o+r ${quartzOutput}`, { stdio: 'inherit' });
    execSync(`find ${quartzOutput} -type d -exec chmod o+x {} +`, { stdio: 'inherit' });

    // Inject the multi-topic export selector into the built root index.
    injectExportUI(quartzOutput, topics);

    fs.outputFileSync(path.join(quartzOutput, '.last-built'), new Date().toISOString());
    logger.info('Quartz build complete');
  } catch (err) {
    logger.error('Quartz build failed', err.message);
  }
}

function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildTree(topics) {
  const root = { children: new Map(), topic: null };
  for (const t of topics) {
    let cur = root;
    for (const seg of t.split('/')) {
      if (!cur.children.has(seg)) cur.children.set(seg, { children: new Map(), topic: null });
      cur = cur.children.get(seg);
    }
    cur.topic = t;
  }
  return root;
}

// Sort entries so leaf topics come before group folders, alphabetically within each.
function sortEntries(entries) {
  return [...entries].sort(([sa, na], [sb, nb]) => {
    const aLeaf = na.topic && na.children.size === 0;
    const bLeaf = nb.topic && nb.children.size === 0;
    if (aLeaf !== bLeaf) return aLeaf ? -1 : 1;
    return sa.localeCompare(sb);
  });
}

function renderNode(node, depth, lines) {
  const indent = '  '.repeat(depth);
  for (const [seg, child] of sortEntries(node.children)) {
    const isLeaf = child.topic && child.children.size === 0;
    if (isLeaf) {
      lines.push(`${indent}- [[${child.topic}/index|${titleCase(seg)}]]  ·  [⬇ Export ZIP](/export/${child.topic})`);
      continue;
    }
    // Group folder (may itself be a published topic — rare but possible)
    lines.push(`${indent}- **${seg}/**`);
    if (child.topic) {
      lines.push(`${indent}  - [[${child.topic}/index|(index)]]  ·  [⬇ Export ZIP](/export/${child.topic})`);
    }
    renderNode(child, depth + 1, lines);
  }
}

function renderRootIndex(topics) {
  const tree = buildTree(topics);
  const lines = [];
  const top = sortEntries(tree.children);
  const leaves  = top.filter(([_, n]) => n.topic && n.children.size === 0);
  const buckets = top.filter(([_, n]) => !(n.topic && n.children.size === 0));

  for (const [seg, node] of leaves) {
    lines.push(`- [[${node.topic}/index|${titleCase(seg)}]]  ·  [⬇ Export ZIP](/export/${node.topic})`);
  }

  for (const [seg, node] of buckets) {
    lines.push('');
    lines.push(`## ${titleCase(seg)}`);
    lines.push('');
    if (node.topic) {
      lines.push(`- [[${node.topic}/index|(index)]]  ·  [⬇ Export ZIP](/export/${node.topic})`);
    }
    renderNode(node, 0, lines);
  }

  return lines.join('\n');
}

module.exports = { scheduleRebuild, runBuild, getPublishedTopics, renderRootIndex };
