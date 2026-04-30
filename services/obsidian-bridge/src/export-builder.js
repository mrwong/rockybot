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
// to a same-directory relative .html path for use inside the ZIP.
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

function rewriteHtml(html, topicSlug) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // Remove elements that don't work or make sense in an offline ZIP export
  $('base').remove();
  $('script').remove();                       // SPA routing, graph, search — all need a server
  $('link[rel="modulepreload"]').remove();    // preloads for removed scripts
  $('.explorer.desktop-only').remove();       // full site navigation tree
  $('.search').remove();                      // search bar (non-functional offline)
  $('.graph-outer').remove();                 // knowledge graph (needs postscript.js)
  $('.backlinks').remove();                   // cross-page backlinks (cross-topic links)

  // Rewrite anchor hrefs
  const absPrefix = `/${topicSlug}`;
  const relPrefix = `../${topicSlug}`;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // External URLs, fragments, mailto → leave unchanged
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

      // Topic files at topicSlug/ in the ZIP — preserves the relative ../X paths
      // that Quartz generates for root-level assets (index.css, static/)
      await walkDir(topicDir, '', async (fullPath, relPath) => {
        const normalizedRel = relPath.replace(/\\/g, '/');
        const zipPath = `${topicSlug}/${normalizedRel}`;
        if (fullPath.endsWith('.html')) {
          const html = await fs.readFile(fullPath, 'utf8');
          archive.append(rewriteHtml(html, topicSlug), { name: zipPath });
        } else {
          archive.file(fullPath, { name: zipPath });
        }
      });

      // Root-level CSS — linked as ../index.css from within topicSlug/
      const rootCss = path.join(quartzOutput, 'index.css');
      if (await fs.pathExists(rootCss)) {
        archive.file(rootCss, { name: 'index.css' });
      }

      // Static assets — linked as ../static/X from within topicSlug/
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
