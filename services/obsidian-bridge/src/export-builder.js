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

// Converts a within-topic href (relative ../topicSlug/X or absolute /topicSlug/X)
// to a same-directory relative .html path (files are at ZIP root).
function rewriteTopicLink(href, topicSlug) {
  const absPrefix = `/${topicSlug}`;
  const relPrefix = `../${topicSlug}`;

  let rest;
  if (href.startsWith(relPrefix)) rest = href.slice(relPrefix.length);
  else if (href.startsWith(absPrefix)) rest = href.slice(absPrefix.length);
  else return null;

  let fragment = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) { fragment = rest.slice(hashIdx); rest = rest.slice(0, hashIdx); }
  rest = rest.replace(/^\/|\/$/g, '');

  if (!rest || rest === 'index') return `./index.html${fragment}`;
  if (!path.extname(rest)) return `./${rest}.html${fragment}`;
  return `./${rest}${fragment}`;
}

// Strips the leading ../ that Quartz generates for paths relative to a topic subdir.
// In the ZIP, those root-level resources (index.css, static/) sit alongside the HTML files.
function stripParent(href) {
  return href.startsWith('../') ? href.slice(3) : href;
}

function rewriteHtml(html, topicSlug) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // Remove elements that don't work in an offline ZIP
  $('base').remove();
  $('script').remove();                     // SPA routing / graph need a server
  $('link[rel="modulepreload"]').remove();  // preloads for removed scripts
  $('.explorer.desktop-only').remove();     // full site navigation tree
  $('.search').remove();                    // search (non-functional offline)
  $('.graph-outer').remove();               // knowledge graph (needs JS)
  $('.backlinks').remove();                 // cross-page backlinks

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
  const absPrefix = `/${topicSlug}`;
  const relPrefix = `../${topicSlug}`;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    if (href.startsWith('http://') || href.startsWith('https://') ||
        href.startsWith('#') || href.startsWith('mailto:')) return;

    // Within-topic: ../topicSlug/... or /topicSlug/...
    if (href === relPrefix || href.startsWith(`${relPrefix}/`) || href.startsWith(`${relPrefix}#`) ||
        href === absPrefix || href.startsWith(`${absPrefix}/`) || href.startsWith(`${absPrefix}#`)) {
      const local = rewriteTopicLink(href, topicSlug);
      if (local) $(el).attr('href', local);
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

function buildTopicExport(quartzOutput, topicSlug, res) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', reject);
    res.on('finish', resolve);
    res.on('error', reject);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${topicSlug}-export.zip"`);
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

module.exports = { buildTopicExport };
