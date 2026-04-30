'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { getPublishedTopics } = require('../../services/obsidian-bridge/src/quartz-builder');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVault(tmpDir, topics) {
  // topics: [{ name, publish, hasIndex }]
  for (const t of topics) {
    const dir = path.join(tmpDir, 'research', t.name);
    fs.mkdirpSync(dir);
    if (t.hasIndex !== false) {
      const frontmatter = t.publish !== undefined
        ? `---\npublish: ${t.publish}\n---\n`
        : `---\ntitle: no publish field\n---\n`;
      fs.writeFileSync(path.join(dir, 'index.md'), frontmatter);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getPublishedTopics', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockybot-vault-'));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('returns empty array when research/ directory does not exist', () => {
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('returns empty array when research/ exists but has no topics', () => {
    fs.mkdirpSync(path.join(tmpDir, 'research'));
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('returns topic with publish: true', () => {
    makeVault(tmpDir, [{ name: 'solar-california', publish: true }]);
    expect(getPublishedTopics(tmpDir)).toEqual(['solar-california']);
  });

  it('excludes topic with publish: false', () => {
    makeVault(tmpDir, [{ name: 'draft-topic', publish: false }]);
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('excludes topic with no publish field', () => {
    makeVault(tmpDir, [{ name: 'no-field-topic', publish: undefined }]);
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('excludes directory with no index.md', () => {
    makeVault(tmpDir, [{ name: 'no-index', publish: true, hasIndex: false }]);
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('ignores files in research/ root (only directories)', () => {
    fs.mkdirpSync(path.join(tmpDir, 'research'));
    fs.writeFileSync(path.join(tmpDir, 'research', 'stray-file.md'), '---\npublish: true\n---\n');
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('returns multiple published topics, excludes unpublished', () => {
    makeVault(tmpDir, [
      { name: 'topic-a', publish: true },
      { name: 'topic-b', publish: false },
      { name: 'topic-c', publish: true },
    ]);
    const result = getPublishedTopics(tmpDir);
    expect(result).toContain('topic-a');
    expect(result).toContain('topic-c');
    expect(result).not.toContain('topic-b');
    expect(result).toHaveLength(2);
  });

  it('slug is the directory name, not the title from frontmatter', () => {
    fs.mkdirpSync(path.join(tmpDir, 'research', 'my-cool-topic'));
    fs.writeFileSync(
      path.join(tmpDir, 'research', 'my-cool-topic', 'index.md'),
      '---\ntitle: My Cool Topic\npublish: true\n---\n'
    );
    expect(getPublishedTopics(tmpDir)).toEqual(['my-cool-topic']);
  });
});
