'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');
const { injectExportUI } = require('./export-ui');
const { fingerprintDir, createBuildGate, publishStage, debounceConfig, writeIfChanged } = require('./build-support');
const { runGardenBuild } = require('./garden-builder');

const DEFAULT_QUARTZ_SRC = '/quartz-src';

let timer = null;
let firstEventAt = null;
const gate = createBuildGate();

function scheduleRebuild(vaultPath, quartzOutput) {
  const { debounceMs, maxWaitMs } = debounceConfig();
  const now = Date.now();
  if (timer) clearTimeout(timer);
  else firstEventAt = now;
  const wait = maxWaitMs > 0 ? Math.max(0, Math.min(debounceMs, firstEventAt + maxWaitMs - now)) : debounceMs;
  timer = setTimeout(() => {
    timer = null;
    runAllBuilds(vaultPath, quartzOutput);
  }, wait);
}

// Private (notes.) build first, then the optional public garden build. Each is
// independent: both catch their own errors, so one failing never blocks the other.
// The garden is a no-op unless GARDEN_OUTPUT is set.
function runAllBuilds(vaultPath, quartzOutput) {
  runBuild(vaultPath, quartzOutput);
  runGardenBuild(vaultPath);
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

function runBuild(vaultPath, quartzOutput, opts = {}) {
  const QUARTZ_SRC = opts.quartzSrc || DEFAULT_QUARTZ_SRC;
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
      `rsync -a --delete --delete-excluded ${includes} --exclude='*' ${vaultPath}/research/ ${QUARTZ_SRC}/content/`,
      { stdio: 'inherit' }
    );

    // Generate a root index so Quartz produces index.html at the site root.
    // Mirrors the PARA directory shape so deeply nested topics are findable.
    writeIfChanged(
      path.join(QUARTZ_SRC, 'content', 'index.md'),
      `---\ntitle: Research\n---\n\n# Research\n\n${renderRootIndex(topics)}\n`
    );

    // Quartz v4.5+ removes the --output directory itself (rmdir) before each
    // build. quartzOutput is a bind-mount whose parent is root-owned, so rmdir
    // on it fails EACCES for our uid (we can write inside it, but not remove
    // it). Build into a container-local staging dir Quartz can freely recreate,
    // then rsync the result into the mounted output dir. Bonus: publishing is
    // now an atomic sync into a populated dir rather than empty-then-rebuild.
    const stageDir = opts.stageDir || '/tmp/quartz-build';
    // Skip when the published content (files + topic set + generated index) is
    // identical to the last successful build; leaves the output untouched.
    const contentFp = fingerprintDir(path.join(QUARTZ_SRC, 'content'));
    if (!gate.needsBuild(contentFp)) {
      logger.info('Published content unchanged — skipping Quartz build');
      return;
    }
    logger.info('Running quartz build');
    if (opts.runQuartz) opts.runQuartz(stageDir);
    else execSync(`npx quartz build --output ${stageDir}`, {
      cwd: QUARTZ_SRC,
      stdio: 'inherit',
    });

    // Inject the multi-topic export selector into the staged root index, so the
    // published copy is final and a checksum publish does not rewrite it twice.
    injectExportUI(stageDir, topics);

    logger.info('Publishing build → output dir');
    publishStage(stageDir, quartzOutput);
    gate.markBuilt(contentFp);

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

module.exports = { scheduleRebuild, runBuild, runAllBuilds, getPublishedTopics, renderRootIndex };
