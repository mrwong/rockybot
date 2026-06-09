'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const cheerio = require('cheerio');
const { injectExportUI } = require('../../services/obsidian-bridge/src/export-ui');

let tmpDir, quartzOutput, indexPath;
const TOPICS = ['my-topic', 'other-topic', 'projects/penang-trip'];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockybot-ui-'));
  quartzOutput = path.join(tmpDir, 'quartz-output');
  fs.mkdirpSync(quartzOutput);
  indexPath = path.join(quartzOutput, 'index.html');
  fs.writeFileSync(indexPath,
    '<!DOCTYPE html><html><body><article><h1>Research</h1></article></body></html>');
});

afterEach(() => fs.removeSync(tmpDir));

describe('injectExportUI', () => {
  it('injects a checkbox per topic plus the export button and handler', () => {
    expect(injectExportUI(quartzOutput, TOPICS)).toBe(true);
    const $ = cheerio.load(fs.readFileSync(indexPath, 'utf8'), { decodeEntities: false });

    expect($('.export-multi')).toHaveLength(1);
    expect($('.export-multi input[type=checkbox]')).toHaveLength(TOPICS.length);
    expect($('#export-multi-btn')).toHaveLength(1);
    // checkbox values are the raw slugs (incl. nested)
    const values = $('.export-multi input[type=checkbox]').map((_, el) => $(el).attr('value')).get();
    expect(values).toEqual(TOPICS);
    // handler is present and wired via onclick
    expect($('#export-multi-btn').attr('onclick')).toBe('exportSelectedTopics()');
    expect(fs.readFileSync(indexPath, 'utf8')).toContain('window.exportSelectedTopics');
  });

  it('is idempotent — re-running does not duplicate the widget', () => {
    injectExportUI(quartzOutput, TOPICS);
    expect(injectExportUI(quartzOutput, TOPICS)).toBe(false);
    const $ = cheerio.load(fs.readFileSync(indexPath, 'utf8'), { decodeEntities: false });
    expect($('.export-multi')).toHaveLength(1);
    expect($('.export-multi input[type=checkbox]')).toHaveLength(TOPICS.length);
  });

  it('no-op when there is no index.html', () => {
    fs.removeSync(indexPath);
    expect(injectExportUI(quartzOutput, TOPICS)).toBe(false);
  });

  it('no-op when there are no topics', () => {
    expect(injectExportUI(quartzOutput, [])).toBe(false);
  });
});
