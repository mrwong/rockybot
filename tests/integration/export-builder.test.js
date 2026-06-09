'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { PassThrough } = require('stream');
const cheerio = require('cheerio');
const { rewriteHtml, buildTopicExport } = require('../../services/obsidian-bridge/src/export-builder');

const FIXTURE_QUARTZ = path.join(__dirname, '../fixtures/test-quartz-output');
const TOPIC = 'my-topic';

// ---------------------------------------------------------------------------
// rewriteHtml — direct tests (no ZIP involved)
// ---------------------------------------------------------------------------

describe('rewriteHtml', () => {
  let $;
  beforeAll(() => {
    const html = fs.readFileSync(
      path.join(FIXTURE_QUARTZ, TOPIC, 'index.html'), 'utf8'
    );
    $ = cheerio.load(rewriteHtml(html, TOPIC), { decodeEntities: false });
  });

  describe('element removal', () => {
    it('removes <base> tag', () => expect($('base')).toHaveLength(0));
    it('removes all <script> tags', () => expect($('script')).toHaveLength(0));
    it('removes <link rel="modulepreload">', () => expect($('link[rel="modulepreload"]')).toHaveLength(0));
    it('removes .explorer.desktop-only', () => expect($('.explorer.desktop-only')).toHaveLength(0));
    it('removes .search', () => expect($('.search')).toHaveLength(0));
    it('removes .graph-outer', () => expect($('.graph-outer')).toHaveLength(0));
    it('removes .backlinks', () => expect($('.backlinks')).toHaveLength(0));
  });

  describe('link[href] path rewriting', () => {
    it('strips ../ from stylesheet: ../index.css → index.css', () => {
      expect($('link[rel="stylesheet"]').attr('href')).toBe('index.css');
    });
    it('strips ../ from icon: ../static/icon.png → static/icon.png', () => {
      expect($('link[rel="icon"]').attr('href')).toBe('static/icon.png');
    });
  });

  describe('img[src] path rewriting', () => {
    it('strips ../ from img src: ../static/icon.png → static/icon.png', () => {
      expect($('#content img').attr('src')).toBe('static/icon.png');
    });
  });

  describe('within-topic anchor rewriting', () => {
    it('../my-topic/sub-page → ./sub-page.html', () => {
      expect($('#content a[href="./sub-page.html"]')).toHaveLength(1);
    });
    it('../my-topic/ (root) → ./index.html', () => {
      expect($('#content a[href="./index.html"]').length).toBeGreaterThanOrEqual(1);
    });
    it('../my-topic (no slash) → ./index.html', () => {
      // both ../my-topic/ and ../my-topic map to ./index.html
      const count = $('a[href="./index.html"]').length;
      expect(count).toBeGreaterThanOrEqual(1);
    });
    it('../my-topic/sub-page#section → ./sub-page.html#section', () => {
      expect($('#content a[href="./sub-page.html#section"]')).toHaveLength(1);
    });
  });

  describe('cross-topic / external link handling', () => {
    it('neuters ../other-topic/page (removes href, adds tooltip class)', () => {
      const neutered = $('#content .export-external-link');
      expect(neutered.length).toBeGreaterThan(0);
      neutered.each((_, el) => expect($(el).attr('href')).toBeUndefined());
    });
    it('neuters ../research/my-topic/sub-page (vault-absolute path)', () => {
      // All neutered links have no href
      const allLinks = $('#content a');
      const withHref = allLinks.filter((_, el) => !!$(el).attr('href'));
      // None of the neutered ones should have href
      withHref.each((_, el) => {
        expect($(el).attr('href')).not.toMatch(/^\.\.\/research\//);
      });
    });
    it('leaves https:// links unchanged', () => {
      expect($('a[href="https://example.com"]')).toHaveLength(1);
    });
    it('leaves #heading anchor-only links unchanged', () => {
      expect($('a[href="#heading"]')).toHaveLength(1);
    });
    it('neuters "." (site root) link', () => {
      expect($('a[href="."]')).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// buildTopicExport — ZIP structure tests
// ---------------------------------------------------------------------------

function buildZip(quartzOutput, topicSlug) {
  return new Promise((resolve, reject) => {
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('error', reject);
    buildTopicExport(quartzOutput, topicSlug, res).then(() => {
      resolve(Buffer.concat(chunks));
    }).catch(reject);
  });
}

describe('buildTopicExport ZIP structure', () => {
  let tmpZip;
  let listing;

  beforeAll(async () => {
    const buf = await buildZip(FIXTURE_QUARTZ, TOPIC);
    tmpZip = path.join(os.tmpdir(), `rockybot-test-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, buf);
    listing = execSync(`unzip -l "${tmpZip}"`).toString();
  });

  afterAll(() => {
    try { fs.unlinkSync(tmpZip); } catch (_) {}
  });

  it('contains index.html at ZIP root', () => expect(listing).toContain('index.html'));
  it('contains sub-page.html at ZIP root', () => expect(listing).toContain('sub-page.html'));
  it('contains index.css at ZIP root', () => expect(listing).toContain('index.css'));
  it('contains static/icon.png', () => expect(listing).toContain('static/icon.png'));
  it('does not contain topic subdir prefix (e.g. my-topic/index.html)', () =>
    expect(listing).not.toContain('my-topic/index.html'));

  it('index.html content has rewritten CSS path', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).toContain('href="index.css"');
    expect(content).not.toContain('href="../index.css"');
  });

  it('index.html has no <script> tags', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).not.toContain('<script');
  });

  it('index.html has no explorer sidebar', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).not.toContain('class="explorer');
  });

  it('within-topic link in sub-page.html is rewritten to ./index.html', () => {
    const content = execSync(`unzip -p "${tmpZip}" sub-page.html`).toString();
    expect(content).toContain('href="./index.html"');
  });
});

// ---------------------------------------------------------------------------
// rewriteHtml — nested PARA topic slugs (e.g. projects/penang-trip)
// ---------------------------------------------------------------------------

describe('rewriteHtml — nested PARA slugs', () => {
  const NESTED = 'projects/penang-trip';

  it('strips multi-level ../ from root resource: ../../index.css → index.css', () => {
    const html = `<html><head><link href="../../index.css" rel="stylesheet"></head><body></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('link[rel="stylesheet"]').attr('href')).toBe('index.css');
  });

  it('strips multi-level ../ from static asset: ../../static/icon.png → static/icon.png', () => {
    const html = `<html><body><img src="../../static/icon.png"></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('img').attr('src')).toBe('static/icon.png');
  });

  it('within-topic relative link with matching depth: ../../projects/penang-trip/sub → ./sub.html', () => {
    const html = `<html><body><a href="../../projects/penang-trip/sub-page">sub</a></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('a').attr('href')).toBe('./sub-page.html');
  });

  it('within-topic absolute link: /projects/penang-trip/sub → ./sub.html', () => {
    const html = `<html><body><a href="/projects/penang-trip/sub-page">sub</a></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('a').attr('href')).toBe('./sub-page.html');
  });

  it('within-topic root link: ../../projects/penang-trip/ → ./index.html', () => {
    const html = `<html><body><a href="../../projects/penang-trip/">root</a></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('a').attr('href')).toBe('./index.html');
  });

  it('cross-topic link from nested topic is neutered (not mis-matched as within-topic)', () => {
    const html = `<html><body><a href="../../areas/health/page">other</a></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    const a = $('a');
    expect(a.attr('href')).toBeUndefined();
    expect(a.hasClass('export-external-link')).toBe(true);
  });

  it('does not mis-match a sibling topic with shared prefix as within-topic', () => {
    // topic is "projects/penang-trip"; this href targets a sibling "projects/penang-trip-2"
    const html = `<html><body><a href="../../projects/penang-trip-2/page">sibling</a></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('a').attr('href')).toBeUndefined();
    expect($('a').hasClass('export-external-link')).toBe(true);
  });

  it('within-topic link with fragment: ../../projects/penang-trip/sub#sec → ./sub.html#sec', () => {
    const html = `<html><body><a href="../../projects/penang-trip/sub-page#section">x</a></body></html>`;
    const $ = cheerio.load(rewriteHtml(html, NESTED), { decodeEntities: false });
    expect($('a').attr('href')).toBe('./sub-page.html#section');
  });
});

// ---------------------------------------------------------------------------
// buildTopicExport — nested PARA topic
// ---------------------------------------------------------------------------

describe('buildTopicExport — nested PARA topic', () => {
  const NESTED = 'projects/penang-trip';
  let tmpQuartz, tmpZip, listing;

  beforeAll(async () => {
    tmpQuartz = fs.mkdtempSync(path.join(os.tmpdir(), 'rockybot-quartz-'));
    const topicDir = path.join(tmpQuartz, NESTED);
    fs.mkdirSync(topicDir, { recursive: true });
    fs.mkdirSync(path.join(tmpQuartz, 'static'), { recursive: true });

    // Simulate a depth-2 Quartz output: two ../ to reach the root
    fs.writeFileSync(path.join(topicDir, 'index.html'), `
      <!DOCTYPE html><html><head>
        <link href="../../index.css" rel="stylesheet">
      </head><body>
        <div id="content">
          <a href="../../projects/penang-trip/sub-page">sub</a>
          <a href="../../areas/health/page">cross-topic</a>
          <img src="../../static/icon.png">
        </div>
      </body></html>`);
    fs.writeFileSync(path.join(topicDir, 'sub-page.html'),
      `<html><body><a href="../../projects/penang-trip/">back</a></body></html>`);
    fs.writeFileSync(path.join(tmpQuartz, 'index.css'), 'body{}');
    fs.writeFileSync(path.join(tmpQuartz, 'static', 'icon.png'), 'PNGSTUB');

    const buf = await buildZip(tmpQuartz, NESTED);
    tmpZip = path.join(os.tmpdir(), `rockybot-nested-test-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, buf);
    listing = execSync(`unzip -l "${tmpZip}"`).toString();
  });

  afterAll(() => {
    try { fs.unlinkSync(tmpZip); } catch (_) {}
    try { fs.rmSync(tmpQuartz, { recursive: true, force: true }); } catch (_) {}
  });

  it('contains index.html at ZIP root (not under projects/penang-trip/)', () => {
    expect(listing).toContain('index.html');
    expect(listing).not.toContain('projects/penang-trip/index.html');
  });

  it('contains sub-page.html at ZIP root', () => {
    expect(listing).toContain('sub-page.html');
  });

  it('contains index.css at ZIP root', () => {
    expect(listing).toContain('index.css');
  });

  it('contains static/icon.png', () => {
    expect(listing).toContain('static/icon.png');
  });

  it('index.html has rewritten CSS path (no .. prefix)', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).toContain('href="index.css"');
    expect(content).not.toContain('href="../');
    expect(content).not.toContain('href="../../');
  });

  it('within-topic link in index.html is rewritten to ./sub-page.html', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).toContain('href="./sub-page.html"');
  });

  it('cross-topic link in index.html is neutered', () => {
    const content = execSync(`unzip -p "${tmpZip}" index.html`).toString();
    expect(content).not.toContain('href="../../areas/');
    expect(content).toContain('export-external-link');
  });

  it('within-topic root link in sub-page.html is rewritten to ./index.html', () => {
    const content = execSync(`unzip -p "${tmpZip}" sub-page.html`).toString();
    expect(content).toContain('href="./index.html"');
  });
});

// ---------------------------------------------------------------------------
// Content-Disposition filename — slashes flattened
// ---------------------------------------------------------------------------

describe('buildTopicExport — Content-Disposition filename', () => {
  function captureHeaders(quartzOutput, topicSlug) {
    return new Promise((resolve, reject) => {
      const headers = {};
      const res = new PassThrough();
      res.setHeader = (k, v) => { headers[k] = v; };
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('error', reject);
      buildTopicExport(quartzOutput, topicSlug, res).then(() => resolve(headers)).catch(reject);
    });
  }

  it('flat slug → my-topic-export.zip', async () => {
    const headers = await captureHeaders(FIXTURE_QUARTZ, TOPIC);
    expect(headers['Content-Disposition']).toBe('attachment; filename="my-topic-export.zip"');
  });

  it('nested slug → projects-penang-trip-export.zip (no slashes in filename)', async () => {
    const tmpQuartz = fs.mkdtempSync(path.join(os.tmpdir(), 'rockybot-cd-'));
    try {
      const topicDir = path.join(tmpQuartz, 'projects', 'penang-trip');
      fs.mkdirSync(topicDir, { recursive: true });
      fs.writeFileSync(path.join(topicDir, 'index.html'), '<html></html>');
      const headers = await captureHeaders(tmpQuartz, 'projects/penang-trip');
      expect(headers['Content-Disposition']).toBe('attachment; filename="projects-penang-trip-export.zip"');
    } finally {
      fs.rmSync(tmpQuartz, { recursive: true, force: true });
    }
  });
});
