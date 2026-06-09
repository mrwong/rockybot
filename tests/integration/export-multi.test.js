'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { PassThrough } = require('stream');
const cheerio = require('cheerio');
const {
  rewriteHtmlMulti,
  buildMultiExport,
  renderLandingPage,
} = require('../../services/obsidian-bridge/src/export-builder');

const FIXTURE_QUARTZ = path.join(__dirname, '../fixtures/test-quartz-output');

// ---------------------------------------------------------------------------
// rewriteHtmlMulti — link/asset rewriting against a topic-prefixed bundle
// ---------------------------------------------------------------------------

describe('rewriteHtmlMulti (other-topic/index.html, bundle = [my-topic, other-topic])', () => {
  let $;
  beforeAll(() => {
    const html = fs.readFileSync(path.join(FIXTURE_QUARTZ, 'other-topic/index.html'), 'utf8');
    $ = cheerio.load(rewriteHtmlMulti(html, 'other-topic/index.html', ['my-topic', 'other-topic']),
      { decodeEntities: false });
  });

  describe('offline element removal', () => {
    it('removes <base>, <script>, modulepreload, explorer, search, graph, backlinks', () => {
      expect($('base')).toHaveLength(0);
      expect($('script')).toHaveLength(0);
      expect($('link[rel="modulepreload"]')).toHaveLength(0);
      expect($('.explorer.desktop-only')).toHaveLength(0);
      expect($('.search')).toHaveLength(0);
      expect($('.graph-outer')).toHaveLength(0);
      expect($('.backlinks')).toHaveLength(0);
    });
  });

  describe('shared asset paths (depth-1 page → ../)', () => {
    it('stylesheet ../index.css stays ../index.css', () =>
      expect($('link[rel="stylesheet"]').attr('href')).toBe('../index.css'));
    it('icon ../static/icon.png stays ../static/icon.png', () =>
      expect($('link[rel="icon"]').attr('href')).toBe('../static/icon.png'));
    it('img ../static/icon.png stays ../static/icon.png', () =>
      expect($('#content img').attr('src')).toBe('../static/icon.png'));
  });

  describe('in-bundle anchor resolution', () => {
    it('within-topic ../other-topic/page → ./page.html', () =>
      expect($('#content a[href="./page.html"]')).toHaveLength(1));
    it('cross-topic relative ../my-topic/sub-page → ../my-topic/sub-page.html', () =>
      expect($('#content a[href="../my-topic/sub-page.html"]')).toHaveLength(1));
    it('cross-topic absolute /my-topic/ → ../my-topic/index.html', () =>
      expect($('#content a[href="../my-topic/index.html"]')).toHaveLength(1));
    it('preserves fragment: ../my-topic/sub-page#section → ../my-topic/sub-page.html#section', () =>
      expect($('#content a[href="../my-topic/sub-page.html#section"]')).toHaveLength(1));
  });

  describe('out-of-bundle / external handling', () => {
    it('neuters topic not in bundle (../research/secret-topic/page)', () => {
      const neutered = $('#content .export-external-link');
      expect(neutered.length).toBeGreaterThan(0);
      neutered.each((_, el) => expect($(el).attr('href')).toBeUndefined());
    });
    it('leaves https:// links unchanged', () =>
      expect($('a[href="https://example.com"]')).toHaveLength(1));
    it('leaves #heading anchor-only links unchanged', () =>
      expect($('a[href="#heading"]')).toHaveLength(1));
    it('neuters "." (site root) link', () =>
      expect($('#content a[href="."]')).toHaveLength(0));
  });
});

describe('rewriteHtmlMulti — selection narrows resolution', () => {
  it('neuters my-topic link when only other-topic is in the bundle', () => {
    const html = fs.readFileSync(path.join(FIXTURE_QUARTZ, 'other-topic/index.html'), 'utf8');
    const $ = cheerio.load(rewriteHtmlMulti(html, 'other-topic/index.html', ['other-topic']),
      { decodeEntities: false });
    // No link should now point into my-topic
    $('#content a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) expect(href).not.toMatch(/my-topic/);
    });
    // The within-topic link still resolves
    expect($('#content a[href="./page.html"]')).toHaveLength(1);
  });
});

describe('rewriteHtmlMulti — nested-slug depth math', () => {
  let $;
  beforeAll(() => {
    const html = `<html><head><link href="../../index.css" rel="stylesheet"></head>` +
      `<body><div id="content">` +
      `<a href="../../resources/hobbies/page">cross</a>` +
      `<a href="../../projects/penang-trip/sub">self</a>` +
      `</div></body></html>`;
    $ = cheerio.load(
      rewriteHtmlMulti(html, 'projects/penang-trip/index.html',
        ['projects/penang-trip', 'resources/hobbies']),
      { decodeEntities: false });
  });
  it('asset ../../index.css stays ../../index.css (depth-2 page)', () =>
    expect($('link[rel="stylesheet"]').attr('href')).toBe('../../index.css'));
  it('cross nested topic → ../../resources/hobbies/page.html', () =>
    expect($('a[href="../../resources/hobbies/page.html"]')).toHaveLength(1));
  it('within nested topic → ./sub.html', () =>
    expect($('a[href="./sub.html"]')).toHaveLength(1));
});

// ---------------------------------------------------------------------------
// renderLandingPage
// ---------------------------------------------------------------------------

describe('renderLandingPage', () => {
  it('lists each topic with a link to its index.html', () => {
    const $ = cheerio.load(renderLandingPage(['my-topic', 'projects/penang-trip']));
    expect($('a[href="my-topic/index.html"]')).toHaveLength(1);
    expect($('a[href="projects/penang-trip/index.html"]')).toHaveLength(1);
    expect($('a[href="my-topic/index.html"]').text()).toBe('My Topic');
    expect($('a[href="projects/penang-trip/index.html"]').text()).toBe('Projects / Penang Trip');
    expect($('link[rel="stylesheet"]').attr('href')).toBe('index.css');
  });
});

// ---------------------------------------------------------------------------
// buildMultiExport — ZIP structure
// ---------------------------------------------------------------------------

function buildZip(quartzOutput, slugs) {
  return new Promise((resolve, reject) => {
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('error', reject);
    buildMultiExport(quartzOutput, slugs, res)
      .then(() => resolve(Buffer.concat(chunks)))
      .catch(reject);
  });
}

describe('buildMultiExport ZIP structure (my-topic + other-topic)', () => {
  let tmpZip, listing;

  beforeAll(async () => {
    const buf = await buildZip(FIXTURE_QUARTZ, ['my-topic', 'other-topic']);
    tmpZip = path.join(os.tmpdir(), `rockybot-multi-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, buf);
    listing = execSync(`unzip -l "${tmpZip}"`).toString();
  });

  afterAll(() => { try { fs.unlinkSync(tmpZip); } catch (_) {} });

  it('preserves topic-prefixed layout', () => {
    expect(listing).toContain('my-topic/index.html');
    expect(listing).toContain('my-topic/sub-page.html');
    expect(listing).toContain('other-topic/index.html');
    expect(listing).toContain('other-topic/page.html');
  });

  it('includes shared root assets once', () => {
    expect(listing).toContain('index.css');
    expect(listing).toContain('static/icon.png');
  });

  it('includes a generated landing index.html at the ZIP root', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).toContain('Research Export');
    expect(content).toContain('href="my-topic/index.html"');
    expect(content).toContain('href="other-topic/index.html"');
  });

  it('resolves a cross-topic link when the target is in the bundle', () => {
    const content = execSync(`unzip -p "${tmpZip}" my-topic/index.html`).toString();
    // my-topic/index.html links to ../other-topic/page → now a working .html path
    expect(content).toContain('href="../other-topic/page.html"');
  });

  it('strips scripts from every page', () => {
    for (const f of ['my-topic/index.html', 'other-topic/index.html']) {
      const content = execSync(`unzip -p "${tmpZip}" ${f}`).toString();
      expect(content).not.toContain('<script');
    }
  });
});

describe('buildMultiExport — single-topic selection neuters out-of-bundle links', () => {
  let tmpZip;
  beforeAll(async () => {
    const buf = await buildZip(FIXTURE_QUARTZ, ['other-topic']);
    tmpZip = path.join(os.tmpdir(), `rockybot-multi-one-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, buf);
  });
  afterAll(() => { try { fs.unlinkSync(tmpZip); } catch (_) {} });

  it('neuters the my-topic cross-link (not in selection)', () => {
    const content = execSync(`unzip -p "${tmpZip}" other-topic/index.html`).toString();
    expect(content).toContain('export-external-link');
    expect(content).not.toContain('href="../my-topic');
  });
});
