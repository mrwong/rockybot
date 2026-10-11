'use strict';

// Public "garden" site: a second Quartz build that contains ONLY topics whose
// index.md frontmatter has both `publish: true` and `public: true`.
//
// Safety properties (all fail closed):
//  - flags are read from the YAML frontmatter block only, never from the body
//  - a nested topic (subdir with its own index.md) is included only if it is
//    itself public; a public parent never implies a public child
//  - symlinks are never followed or copied (the vault is mounted in the
//    container, so a link could otherwise reach private files)
//  - dotfiles/dot-directories are never copied
//  - the content dir holds nothing but selected files + a generated root index
//
// The selection and copy logic here does not need Quartz, so it is unit-testable.

const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');

const SKIP_DIRS = new Set(['inbox', 'processed', '.trash']);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// Returns the frontmatter text, or null if there is no well-formed leading block.
function extractFrontmatter(content) {
  const m = FRONTMATTER_RE.exec(content);
  return m ? m[1] : null;
}

// True only if the key appears exactly once at column 0 and its value is the bare
// scalar `true` (optionally followed by a comment). Duplicates, quoted values and
// anything else are false.
function frontmatterFlagTrue(fm, key) {
  const lines = fm.split(/\r?\n/).filter(l => new RegExp(`^${key}[ \\t]*:`).test(l));
  if (lines.length !== 1) return false;
  return new RegExp(`^${key}[ \\t]*:[ \\t]+true[ \\t]*(?:#.*)?$`).test(lines[0]);
}

// -> { publish: bool, public: bool }; unreadable / malformed -> both false.
function readGardenFlags(content) {
  const fm = typeof content === 'string' ? extractFrontmatter(content) : null;
  if (fm === null) return { publish: false, public: false };
  return {
    publish: frontmatterFlagTrue(fm, 'publish'),
    public: frontmatterFlagTrue(fm, 'public'),
  };
}

function isRealDir(p) {
  try { return fs.lstatSync(p).isDirectory(); } catch { return false; }
}

function readTopicIndex(indexPath) {
  try {
    const st = fs.lstatSync(indexPath);
    if (!st.isFile()) return null;          // symlink / dir / other: fail closed
    return fs.readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
}

// -> { topics: string[] (sorted), warnings: string[] }
function selectPublicTopics(vaultPath) {
  const researchDir = path.join(vaultPath, 'research');
  const topics = [];
  const warnings = [];
  if (!isRealDir(researchDir)) return { topics, warnings };

  function scanDir(dir, relPrefix) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      // Dirent.isDirectory() is false for symlinks, so links are never followed.
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const content = readTopicIndex(path.join(dir, entry.name, 'index.md'));
      if (content !== null) {
        const flags = readGardenFlags(content);
        if (flags.public && flags.publish) topics.push(relPath);
        else if (flags.public && !flags.publish) {
          warnings.push(`topic "${relPath}" has public: true but not publish: true — NOT published to the garden`);
        }
      }
      scanDir(path.join(dir, entry.name), relPath);
    }
  }

  scanDir(researchDir, '');
  topics.sort();
  return { topics, warnings };
}

function readFileNoFollow(abs) {
  const fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    if (st.size > MAX_FILE_BYTES) return { tooBig: true };
    return { buf: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}

// Collect the files a public topic contributes: its own folder plus plain
// subfolders. Subfolders with their own index.md (nested topics) are boundaries.
function collectTopicFiles(vaultPath, topic, out, warnings) {
  function walk(absDir, rel) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(absDir, entry.name);
      const relPath = `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;                 // never copy or follow
      if (entry.isDirectory()) {
        let hasOwnIndex = true;
        try { fs.lstatSync(path.join(abs, 'index.md')); } catch { hasOwnIndex = false; }
        if (hasOwnIndex) continue;                          // nested topic: only via its own flags
        walk(abs, relPath);
      } else if (entry.isFile()) {
        let data;
        try { data = readFileNoFollow(abs); } catch { continue; }
        if (!data) continue;
        if (data.tooBig) { warnings.push(`skipped ${relPath}: larger than ${MAX_FILE_BYTES} bytes`); continue; }
        out.set(relPath, data.buf);
      }
    }
  }
  walk(path.join(vaultPath, 'research', topic), topic);
}

function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Root index for the garden: public topics only, no export links.
function renderGardenRootIndex(topics) {
  const flat = topics.filter(t => !t.includes('/'));
  const grouped = new Map();
  for (const t of topics) {
    if (!t.includes('/')) continue;
    const [head, ...rest] = t.split('/');
    if (!grouped.has(head)) grouped.set(head, []);
    grouped.get(head).push([t, rest.join('/')]);
  }
  const lines = [];
  for (const t of flat) lines.push(`- [[${t}/index|${titleCase(t)}]]`);
  for (const [head, items] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push('', `## ${titleCase(head)}`, '');
    for (const [t, rest] of items) lines.push(`- [[${t}/index|${titleCase(rest.split('/').join(' / '))}]]`);
  }
  return `---\ntitle: Garden\n---\n\n# Garden\n\n${lines.join('\n')}\n`;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Select public topics, compute a content fingerprint over exactly the files that
// would be published and, if it differs from `prevFingerprint`, rebuild
// `contentDir` from scratch. Writes nothing when the fingerprint is unchanged.
// -> { changed, fingerprint, topics, fileCount, warnings }
function syncGardenContent(vaultPath, contentDir, prevFingerprint) {
  const { topics, warnings } = selectPublicTopics(vaultPath);
  const files = new Map();
  for (const t of topics) collectTopicFiles(vaultPath, t, files, warnings);

  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(topics) + '\n');
  for (const rel of [...files.keys()].sort()) h.update(`${rel}\0${sha256(files.get(rel))}\n`);
  const fingerprint = h.digest('hex');

  const result = { changed: false, fingerprint, topics, fileCount: files.size, warnings };
  if (prevFingerprint && prevFingerprint === fingerprint) return result;

  fs.emptyDirSync(contentDir);
  for (const [rel, buf] of files) fs.outputFileSync(path.join(contentDir, rel), buf);
  if (topics.length > 0) fs.outputFileSync(path.join(contentDir, 'index.md'), renderGardenRootIndex(topics));
  result.changed = true;
  return result;
}

const PLACEHOLDER_HTML = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="robots" content="noindex,nofollow"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>\n`;

function writePlaceholderSite(dir) {
  fs.emptyDirSync(dir);
  fs.outputFileSync(path.join(dir, 'index.html'), PLACEHOLDER_HTML('Garden', 'Nothing is published here yet.'));
  fs.outputFileSync(path.join(dir, '404.html'), PLACEHOLDER_HTML('Not found', 'There is nothing at this address.'));
}

// Module state: fingerprint of the last successful garden build (null = build next time).
let lastFingerprint = null;
function resetGardenState() { lastFingerprint = null; }

// Builds the garden if GARDEN_OUTPUT (or opts.gardenOutput) is set. Never throws.
// -> { status: 'disabled' | 'unchanged' | 'built' | 'failed', ... }
function runGardenBuild(vaultPath, opts = {}) {
  const gardenOutput = opts.gardenOutput !== undefined ? opts.gardenOutput : process.env.GARDEN_OUTPUT;
  if (!gardenOutput) return { status: 'disabled' };
  const contentDir = opts.contentDir || '/tmp/garden-content';
  const stageDir = opts.stageDir || '/tmp/garden-build';
  const quartzSrc = opts.quartzSrc || '/quartz-src';
  const domain = opts.domain || process.env.DOMAIN_NAME || 'localhost';
  const sub = process.env.GARDEN_SUBDOMAIN || 'garden';
  const baseUrl = `${sub}.${domain}`;

  try {
    const res = syncGardenContent(vaultPath, contentDir, lastFingerprint);
    for (const w of res.warnings) logger.warn(`[garden] ${w}`);
    if (!res.changed) {
      logger.debug('[garden] public content unchanged — skipping garden build');
      return { status: 'unchanged', topics: res.topics };
    }

    if (res.topics.length === 0) {
      logger.warn('[garden] no public topics (publish: true + public: true) — publishing empty placeholder');
      writePlaceholderSite(stageDir);
    } else {
      logger.info(`[garden] publishing ${res.topics.length} public topic(s): ${res.topics.join(', ')}`);
      // Own content dir (-d) and own base URL (env read by quartz.config.ts); the
      // private build keeps /quartz-src/content and its notes.<domain> base URL.
      execSync(`npx quartz build -d ${contentDir} --output ${stageDir}`, {
        cwd: quartzSrc,
        stdio: 'inherit',
        env: { ...process.env, QUARTZ_BASE_URL_OVERRIDE: baseUrl },
      });
    }

    fs.ensureDirSync(gardenOutput);
    execSync(`rsync -a --delete ${stageDir}/ ${gardenOutput}/`, { stdio: 'inherit' });
    execSync(`chmod -R o+r ${gardenOutput}`, { stdio: 'inherit' });
    execSync(`find ${gardenOutput} -type d -exec chmod o+x {} +`, { stdio: 'inherit' });
    // No export-UI injection here: the garden has no export links.
    fs.outputFileSync(path.join(gardenOutput, '.last-built'), new Date().toISOString());

    lastFingerprint = res.fingerprint;
    logger.info('[garden] build complete');
    return { status: 'built', topics: res.topics };
  } catch (err) {
    lastFingerprint = null;     // retry on the next trigger
    logger.error('[garden] build failed', err.message);
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  readGardenFlags,
  selectPublicTopics,
  syncGardenContent,
  renderGardenRootIndex,
  writePlaceholderSite,
  runGardenBuild,
  resetGardenState,
};
