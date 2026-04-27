'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');

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
  const entries = fs.readdirSync(researchDir, { withFileTypes: true });
  const published = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(researchDir, entry.name, 'index.md');
    if (!fs.existsSync(indexPath)) continue;
    const content = fs.readFileSync(indexPath, 'utf8');
    const match = content.match(/^publish:\s*(true|false)/m);
    if (match && match[1] === 'true') published.push(entry.name);
  }
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

    const includes = topics.map(t => `--include='/${t}/***'`).join(' ');
    logger.info('Syncing published topics → quartz content dir');
    execSync(
      `rsync -a --delete ${includes} --exclude='*' ${vaultPath}/research/ ${QUARTZ_SRC}/content/`,
      { stdio: 'inherit' }
    );

    // Generate a root index so Quartz produces index.html at the site root
    const topicLinks = topics.map(t => `- [[${t}/index|${t.replace(/-/g, ' ')}]]`).join('\n');
    fs.outputFileSync(
      path.join(QUARTZ_SRC, 'content', 'index.md'),
      `---\ntitle: Research\n---\n\n# Research\n\n${topicLinks}\n`
    );

    logger.info('Running quartz build');
    execSync(`npx quartz build --output ${quartzOutput}`, {
      cwd: QUARTZ_SRC,
      stdio: 'inherit',
    });

    // NFS ACLs strip world-readable bits; restore them so nginx can serve the files
    execSync(`chmod -R o+r ${quartzOutput}`, { stdio: 'inherit' });
    execSync(`find ${quartzOutput} -type d -exec chmod o+x {} +`, { stdio: 'inherit' });

    fs.outputFileSync(path.join(quartzOutput, '.last-built'), new Date().toISOString());
    logger.info('Quartz build complete');
  } catch (err) {
    logger.error('Quartz build failed', err.message);
  }
}

module.exports = { scheduleRebuild, runBuild };
