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

function rewriteHtml(html, topicSlug, depth) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const prefix = '../'.repeat(depth);
  const topicPrefix = `/${topicSlug}`;

  // Remove <base> tag — we use explicit relative paths throughout
  $('base').remove();

  function rewriteStaticSrc(p) {
    return prefix + p.slice(1); // /static/foo.js → {prefix}static/foo.js
  }

  function rewriteTopicHref(href, isPageLink) {
    let rest = href.slice(topicPrefix.length); // strip /topicSlug prefix

    let fragment = '';
    const hashIdx = rest.indexOf('#');
    if (hashIdx !== -1) {
      fragment = rest.slice(hashIdx);
      rest = rest.slice(0, hashIdx);
    }

    rest = rest.replace(/^\/|\/$/g, ''); // strip leading/trailing slashes

    if (!rest || rest === 'index') {
      return `${prefix}index.html${fragment}`;
    }
    // Clean URL (no file extension) → Quartz page → append /index.html
    if (isPageLink && !path.extname(rest)) {
      return `${prefix}${rest}/index.html${fragment}`;
    }
    // Has extension (image, PDF, etc.) → resource file
    return `${prefix}${rest}${fragment}`;
  }

  // Static asset src (scripts, images)
  $('script[src], img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && src.startsWith('/static/')) {
      $(el).attr('src', rewriteStaticSrc(src));
    }
  });

  // link href (stylesheets, preloads, fonts)
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith('/static/')) {
      $(el).attr('href', rewriteStaticSrc(href));
    }
  });

  // Anchor links
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // External URLs and fragment-only links — leave unchanged
    if (href.startsWith('http://') || href.startsWith('https://') ||
        href.startsWith('#') || href.startsWith('mailto:')) {
      return;
    }

    if (href.startsWith('/static/')) {
      $(el).attr('href', rewriteStaticSrc(href));
      return;
    }

    // Within-topic links: /topicSlug, /topicSlug/, /topicSlug/page, /topicSlug#anchor
    if (href === topicPrefix ||
        href.startsWith(`${topicPrefix}/`) ||
        href.startsWith(`${topicPrefix}#`)) {
      $(el).attr('href', rewriteTopicHref(href, true));
      return;
    }

    // Cross-topic absolute links — neuter: remove href, keep text, add tooltip
    if (href.startsWith('/')) {
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

      await walkDir(topicDir, '', async (fullPath, relPath) => {
        const normalizedRel = relPath.replace(/\\/g, '/');
        if (fullPath.endsWith('.html')) {
          const depth = normalizedRel.split('/').length - 1;
          const html = await fs.readFile(fullPath, 'utf8');
          const rewritten = rewriteHtml(html, topicSlug, depth);
          archive.append(rewritten, { name: normalizedRel });
        } else {
          archive.file(fullPath, { name: normalizedRel });
        }
      });

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
