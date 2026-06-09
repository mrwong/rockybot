'use strict';

// Injects a multi-topic export widget (checkbox per topic + "Export selected"
// button) into the built root index.html. The live Quartz site is otherwise
// static HTML, so the selection UI is a small post-build patch: a checkbox list
// and a global handler that navigates to /export?slugs=<csv>.
//
// Idempotent: re-running on an already-patched page is a no-op. The per-topic
// "⬇ Export ZIP" quick-links in the generated index.md are left untouched.

const path = require('path');
const fs = require('fs-extra');
const cheerio = require('cheerio');
const logger = require('./logger');

function titleizeSlug(slug) {
  return slug
    .split('/')
    .map(seg => seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' / ');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// onclick attribute calls a window-scoped function so it survives Quartz's SPA
// content swaps (an attached listener would be lost on re-navigation).
const HANDLER_SCRIPT = `
window.exportSelectedTopics = function () {
  var boxes = document.querySelectorAll('.export-multi input[type=checkbox]:checked');
  var slugs = Array.prototype.map.call(boxes, function (b) { return b.value; });
  if (slugs.length === 0) { alert('Select at least one topic to export.'); return; }
  window.location.href = '/export?slugs=' + encodeURIComponent(slugs.join(','));
};
`;

function buildWidget(topics) {
  const checkboxes = topics.map((slug) => {
    const safe = escapeHtml(slug);
    return `      <label class="export-multi-item"><input type="checkbox" value="${safe}"> ${escapeHtml(titleizeSlug(slug))}</label>`;
  }).join('\n');

  return `<details class="export-multi">
    <summary>⬇ Export multiple topics as a ZIP</summary>
    <div class="export-multi-body">
${checkboxes}
      <p><button type="button" id="export-multi-btn" onclick="exportSelectedTopics()">⬇ Export selected</button></p>
      <small>Links between topics you include here resolve inside the ZIP; links to topics left out are disabled.</small>
    </div>
  </details>`;
}

// Reads quartzOutput/index.html, injects the widget, and writes it back.
// Returns true if patched, false if skipped (no index, or already patched).
function injectExportUI(quartzOutput, topics) {
  const indexPath = path.join(quartzOutput, 'index.html');
  if (!fs.existsSync(indexPath) || !topics || topics.length === 0) return false;

  const $ = cheerio.load(fs.readFileSync(indexPath, 'utf8'), { decodeEntities: false });
  if ($('.export-multi').length > 0) return false; // already patched

  const widget = buildWidget(topics);
  const mount = $('article').first().length ? $('article').first()
    : ($('#content').first().length ? $('#content').first() : $('body').first());
  mount.prepend(widget);
  $('body').append(`<script>${HANDLER_SCRIPT}</script>`);

  fs.writeFileSync(indexPath, $.html());
  logger.info(`Export UI: injected multi-select widget for ${topics.length} topic(s)`);
  return true;
}

module.exports = { injectExportUI };
