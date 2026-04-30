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
