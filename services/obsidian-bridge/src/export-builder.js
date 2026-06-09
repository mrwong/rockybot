'use strict';

const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const cheerio = require('cheerio');

async function walkDir(dirPath, baseRel, callback) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkDir(fullPath, relPath, callback);
    } else if (entry.isFile()) {
      await callback(fullPath, relPath);
    }
  }
}

// Converts a within-topic href to a same-directory relative .html path (files are at
// ZIP root). Handles:
//  - absolute: /topicSlug/X
//  - relative: (../)+topicSlug/X  — Quartz emits one ../ per ancestor of the page, so
//    a nested topic like "projects/foo" produces "../../projects/foo/sub" from foo/index.
function rewriteTopicLink(href, topicSlug) {
  const absPrefix = `/${topicSlug}`;
  let rest;

  const upMatch = href.match(/^(?:\.\.\/)+/);
  if (upMatch) {
    const afterUp = href.slice(upMatch[0].length);
    if (afterUp === topicSlug ||
        afterUp.startsWith(`${topicSlug}/`) ||
        afterUp.startsWith(`${topicSlug}#`)) {
      rest = afterUp.slice(topicSlug.length);
    } else {
      return null;
    }
  } else if (href === absPrefix ||
             href.startsWith(`${absPrefix}/`) ||
             href.startsWith(`${absPrefix}#`)) {
    rest = href.slice(absPrefix.length);
  } else {
    return null;
  }

  let fragment = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) { fragment = rest.slice(hashIdx); rest = rest.slice(0, hashIdx); }
  rest = rest.replace(/^\/|\/$/g, '');

  if (!rest || rest === 'index') return `./index.html${fragment}`;
  if (!path.extname(rest)) return `./${rest}.html${fragment}`;
  return `./${rest}${fragment}`;
}

// Strips ALL leading ../ segments Quartz generates for root-level resources
// (index.css, static/). For a depth-2 topic like projects/foo, Quartz emits
// ../../index.css; in the flat ZIP these resources sit alongside the HTML files.
function stripParent(href) {
  return href.replace(/^(?:\.\.\/)+/, '');
}

// Strips the elements that can't work in a server-less offline ZIP. Shared by the
// single-topic (flat) and multi-topic (nested) HTML rewriters.
function stripOfflineElements($) {
  $('base').remove();
  $('script').remove();                     // SPA routing / graph need a server
  $('link[rel="modulepreload"]').remove();  // preloads for removed scripts
  $('.explorer.desktop-only').remove();     // full site navigation tree
  $('.search').remove();                    // search (non-functional offline)
  $('.graph-outer').remove();               // knowledge graph (needs JS)
  $('.backlinks').remove();                 // cross-page backlinks
}

function rewriteHtml(html, topicSlug) {
  const $ = cheerio.load(html, { decodeEntities: false });

  stripOfflineElements($);

  // Fix <link> hrefs: strip ../ from root-level resources (index.css, static/)
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('http://') || href.startsWith('https://')) return;
    if (href.startsWith('../')) $(el).attr('href', stripParent(href));
  });

  // Fix <img> srcs
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || src.startsWith('http://') || src.startsWith('https://')) return;
    if (src.startsWith('../')) $(el).attr('src', stripParent(src));
    else if (src.startsWith('/static/')) $(el).attr('src', src.slice(1)); // /static/X → static/X
  });

  // Rewrite anchor hrefs
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    if (href.startsWith('http://') || href.startsWith('https://') ||
        href.startsWith('#') || href.startsWith('mailto:')) return;

    // Within-topic? rewriteTopicLink returns null if not.
    const local = rewriteTopicLink(href, topicSlug);
    if (local !== null) {
      $(el).attr('href', local);
      return;
    }

    // Everything else (cross-topic, site root, tags, search) → neuter
    if (href.startsWith('/') || href.startsWith('../') || href.startsWith('./') || href === '.') {
      $(el).removeAttr('href');
      $(el).attr('title', 'External topic (not included in export)');
      $(el).addClass('export-external-link');
    }
  });

  return $.html();
}

// -- Multi-topic export -----------------------------------------------------
// Unlike the single-topic flat export, the multi-topic bundle PRESERVES Quartz's
// native directory layout (topic-prefixed: <slug>/index.html, shared root
// index.css + static/). Because Quartz emits relative paths, that means in-bundle
// links and assets already point at the right place — we only normalize them to
// portable file:// relative paths and neuter links whose target topic isn't in the
// selection. Slugs may be nested (e.g. "projects/penang-trip").

const EXTERNAL_RE = /^(?:https?:|mailto:|tel:|data:)/i;

// Resolve an href to a normalized ZIP-root-relative path (no leading slash, no
// fragment). Returns null if it escapes the root or is otherwise unusable.
function resolveRootRel(href, fileDir) {
  let target;
  if (href.startsWith('/')) {
    target = href.slice(1);
  } else {
    target = path.posix.join(fileDir, href);
  }
  target = path.posix.normalize(target);
  if (target === '.' || target === './') return '';
  if (target === '..' || target.startsWith('../')) return null; // escapes root
  return target.replace(/\/$/, '');
}

// Make a root-relative target portable from a file living at fileDir.
function relFromDir(fileDir, target) {
  let rel = path.posix.relative(fileDir, target);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

// Find the bundle slug that owns a root-relative target (exact topic root or a
// page within it). Returns the slug or null. Trailing-slash guard prevents
// "projects/foo" from matching a target under "projects/foobar".
function owningSlug(target, bundleSlugs) {
  for (const slug of bundleSlugs) {
    if (target === slug || target.startsWith(`${slug}/`)) return slug;
  }
  return null;
}

// Map a root-relative in-bundle target to its built .html path.
function toHtmlPath(target, slug) {
  if (target === slug) return `${slug}/index.html`;
  if (path.posix.extname(target)) return target; // already a concrete file
  return `${target}.html`;
}

function neuter($el) {
  $el.removeAttr('href');
  $el.attr('title', 'External topic (not included in export)');
  $el.addClass('export-external-link');
}

// Rewrites one topic-prefixed HTML page for the multi-topic bundle. fileRelPath is
// the page's path within the ZIP (e.g. "projects/penang-trip/index.html").
function rewriteHtmlMulti(html, fileRelPath, bundleSlugs) {
  const $ = cheerio.load(html, { decodeEntities: false });
  stripOfflineElements($);
  const fileDir = path.posix.dirname(fileRelPath);

  // Assets: re-relativize to the shared root-level index.css / static/ dir.
  const fixAsset = (el, attr) => {
    const val = $(el).attr(attr);
    if (!val || EXTERNAL_RE.test(val) || val.startsWith('#')) return;
    const target = resolveRootRel(val, fileDir);
    if (target === null || target === '') return;
    $(el).attr(attr, relFromDir(fileDir, target));
  };
  $('link[href]').each((_, el) => fixAsset(el, 'href'));
  $('img[src]').each((_, el) => fixAsset(el, 'src'));

  // Anchors: resolve in-bundle links, neuter everything else.
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (EXTERNAL_RE.test(href) || href.startsWith('#')) return;
    if (href === '.' || href === './' || href === '/') { neuter($(el)); return; }

    const hashIdx = href.indexOf('#');
    const fragment = hashIdx !== -1 ? href.slice(hashIdx) : '';
    const bare = hashIdx !== -1 ? href.slice(0, hashIdx) : href;

    const target = resolveRootRel(bare, fileDir);
    if (!target) { neuter($(el)); return; }

    const slug = owningSlug(target, bundleSlugs);
    if (!slug) { neuter($(el)); return; }

    $(el).attr('href', relFromDir(fileDir, toHtmlPath(target, slug)) + fragment);
  });

  return $.html();
}

function titleizeSlug(slug) {
  return slug
    .split('/')
    .map(seg => seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' / ');
}

// A minimal, dependency-free landing page listing the exported topics. Links the
// shared root index.css so it inherits the site's styling offline.
function renderLandingPage(slugs) {
  const items = slugs
    .map(s => `      <li><a href="${s}/index.html">${titleizeSlug(s)}</a></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Research Export</title>
  <link href="index.css" rel="stylesheet" type="text/css">
</head>
<body>
  <article style="max-width: 720px; margin: 2rem auto; padding: 0 1rem;">
    <h1>Research Export</h1>
    <p>This bundle contains ${slugs.length} topic${slugs.length === 1 ? '' : 's'}. Links between topics included here resolve locally; links to topics outside the bundle are disabled.</p>
    <ul>
${items}
    </ul>
  </article>
</body>
</html>
`;
}

function buildMultiExport(quartzOutput, slugs, res) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', reject);
    res.on('finish', resolve);
    res.on('error', reject);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="research-export.zip"');
    archive.pipe(res);

    (async () => {
      // Track names already added so an ancestor topic (e.g. "projects") that also
      // contains a separately-selected child ("projects/foo") doesn't double-add.
      const seen = new Set();
      const addFile = (fullPath, name) => {
        if (seen.has(name)) return;
        seen.add(name);
        archive.file(fullPath, { name });
      };

      for (const slug of slugs) {
        const topicDir = path.join(quartzOutput, slug);
        await walkDir(topicDir, slug, async (fullPath, relPath) => {
          const name = relPath.replace(/\\/g, '/');
          if (seen.has(name)) return;
          if (fullPath.endsWith('.html')) {
            const html = await fs.readFile(fullPath, 'utf8');
            seen.add(name);
            archive.append(rewriteHtmlMulti(html, name, slugs), { name });
          } else {
            addFile(fullPath, name);
          }
        });
      }

      // Shared root-level assets, added once for the whole bundle.
      const rootCss = path.join(quartzOutput, 'index.css');
      if (await fs.pathExists(rootCss)) addFile(rootCss, 'index.css');

      const staticDir = path.join(quartzOutput, 'static');
      if (await fs.pathExists(staticDir)) {
        await walkDir(staticDir, 'static', async (fullPath, relPath) => {
          addFile(fullPath, relPath.replace(/\\/g, '/'));
        });
      }

      // Landing page at ZIP root (overrides any topic that happened to land here).
      archive.append(renderLandingPage(slugs), { name: 'index.html' });

      archive.finalize();
    })().catch(reject);
  });
}

function buildTopicExport(quartzOutput, topicSlug, res) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', reject);
    res.on('finish', resolve);
    res.on('error', reject);

    res.setHeader('Content-Type', 'application/zip');
    // Flatten nested slug (projects/foo → projects-foo) for the download filename
    const safeName = topicSlug.replace(/\//g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-export.zip"`);
    archive.pipe(res);

    (async () => {
      const topicDir = path.join(quartzOutput, topicSlug);
      const staticDir = path.join(quartzOutput, 'static');

      // HTML files at ZIP root — then fix paths that Quartz generated relative to topicSlug/
      await walkDir(topicDir, '', async (fullPath, relPath) => {
        const normalizedRel = relPath.replace(/\\/g, '/');
        if (fullPath.endsWith('.html')) {
          const html = await fs.readFile(fullPath, 'utf8');
          archive.append(rewriteHtml(html, topicSlug), { name: normalizedRel });
        } else {
          archive.file(fullPath, { name: normalizedRel });
        }
      });

      // Root-level CSS alongside the HTML files (Quartz links it as ../index.css → index.css)
      const rootCss = path.join(quartzOutput, 'index.css');
      if (await fs.pathExists(rootCss)) {
        archive.file(rootCss, { name: 'index.css' });
      }

      // Static assets directory (Quartz links as ../static/X → static/X)
      if (await fs.pathExists(staticDir)) {
        await walkDir(staticDir, 'static', async (fullPath, relPath) => {
          archive.file(fullPath, { name: relPath.replace(/\\/g, '/') });
        });
      }

      archive.finalize();
    })().catch(reject);
  });
}

module.exports = {
  buildTopicExport,
  rewriteHtml,
  buildMultiExport,
  rewriteHtmlMulti,
  renderLandingPage,
};
