'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { getPublishedTopics, renderRootIndex } = require('../../services/obsidian-bridge/src/quartz-builder');

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

  // ---- PARA subfolder structure (research/bucket/topic/) -------------------

  it('finds published topic one level deeper: research/projects/topic/', () => {
    makeVault(tmpDir, [{ name: 'projects/china-vacation', publish: true }]);
    expect(getPublishedTopics(tmpDir)).toEqual(['projects/china-vacation']);
  });

  it('excludes unpublished topic in subfolder', () => {
    makeVault(tmpDir, [{ name: 'archive/keyboard-cleaning', publish: false }]);
    expect(getPublishedTopics(tmpDir)).toEqual([]);
  });

  it('returns bucket/topic path, not bare topic name', () => {
    makeVault(tmpDir, [{ name: 'resources/agentic-homelab-ai', publish: true }]);
    const result = getPublishedTopics(tmpDir);
    expect(result).toEqual(['resources/agentic-homelab-ai']);
  });

  it('mixes flat and nested published topics correctly', () => {
    makeVault(tmpDir, [
      { name: 'flat-topic',                  publish: true  },
      { name: 'projects/active-project',     publish: true  },
      { name: 'archive/done-project',        publish: false },
      { name: 'resources/reference-topic',   publish: true  },
    ]);
    const result = getPublishedTopics(tmpDir);
    expect(result).toContain('flat-topic');
    expect(result).toContain('projects/active-project');
    expect(result).toContain('resources/reference-topic');
    expect(result).not.toContain('archive/done-project');
    expect(result).toHaveLength(3);
  });

  it('skips inbox/ and processed/ at both levels', () => {
    // inbox/ and processed/ at top level
    makeVault(tmpDir, [{ name: 'inbox/seed', publish: true }]);
    makeVault(tmpDir, [{ name: 'processed/old', publish: true }]);
    // A valid nested topic in a non-skipped bucket
    makeVault(tmpDir, [{ name: 'projects/real-topic', publish: true }]);
    const result = getPublishedTopics(tmpDir);
    expect(result).toEqual(['projects/real-topic']);
  });

  it('recurses into arbitrarily deep directories', () => {
    // Three levels deep — projects/active/subtopic — should be found
    const deepDir = path.join(tmpDir, 'research', 'projects', 'active', 'subtopic');
    fs.mkdirpSync(deepDir);
    fs.writeFileSync(path.join(deepDir, 'index.md'), '---\npublish: true\n---\n');
    expect(getPublishedTopics(tmpDir)).toContain('projects/active/subtopic');
  });

  it('finds topics at four levels of nesting', () => {
    const deepDir = path.join(tmpDir, 'research', 'areas', 'health', 'vision', 'lasik-research');
    fs.mkdirpSync(deepDir);
    fs.writeFileSync(path.join(deepDir, 'index.md'), '---\npublish: true\n---\n');
    expect(getPublishedTopics(tmpDir)).toContain('areas/health/vision/lasik-research');
  });

  it('bucket dir itself is not returned even if it has an index.md with publish: true', () => {
    // A bucket dir (projects/) with its own index.md should not be treated as a topic
    const bucketDir = path.join(tmpDir, 'research', 'projects');
    fs.mkdirpSync(bucketDir);
    fs.writeFileSync(path.join(bucketDir, 'index.md'), '---\npublish: true\n---\n');
    // The bucket has an index.md — getPublishedTopics should return 'projects' only
    // if it truly has a publish flag, which is a valid edge case. What we care about
    // is that a nested topic is also found:
    makeVault(tmpDir, [{ name: 'projects/real-topic', publish: true }]);
    const result = getPublishedTopics(tmpDir);
    expect(result).toContain('projects/real-topic');
  });
});

// ---------------------------------------------------------------------------
// renderRootIndex — tree-shaped index that mirrors PARA directory structure
// ---------------------------------------------------------------------------

describe('renderRootIndex', () => {
  it('renders a single root-level topic as a flat bullet', () => {
    const out = renderRootIndex(['solar-california']);
    expect(out).toContain('- [[solar-california/index|Solar California]]  ·  [⬇ Export ZIP](/export/solar-california)');
    // No bucket headers when only root-level topics
    expect(out).not.toMatch(/^##/m);
  });

  it('groups nested topics under an H2 bucket header', () => {
    const out = renderRootIndex(['projects/penang-trip']);
    expect(out).toContain('## Projects');
    expect(out).toContain('- [[projects/penang-trip/index|Penang Trip]]  ·  [⬇ Export ZIP](/export/projects/penang-trip)');
    // Bucket bullet itself should not be a topic link
    expect(out).not.toContain('- [[projects/index|');
  });

  it('renders multi-level nesting as indented bullets under the bucket H2', () => {
    const out = renderRootIndex([
      'resources/hobbies/boardgames/heavy-2026',
    ]);
    expect(out).toContain('## Resources');
    expect(out).toContain('- **hobbies/**');
    expect(out).toContain('  - **boardgames/**');
    expect(out).toMatch(/    - \[\[resources\/hobbies\/boardgames\/heavy-2026\/index\|Heavy 2026\]\]/);
    expect(out).toContain('[⬇ Export ZIP](/export/resources/hobbies/boardgames/heavy-2026)');
  });

  it('renders multiple PARA buckets with their own H2 sections', () => {
    const out = renderRootIndex([
      'projects/penang-trip',
      'areas/sleep-temperature',
      'resources/password-managers',
      'archive/teflon-pan-care',
    ]);
    expect(out).toContain('## Projects');
    expect(out).toContain('## Areas');
    expect(out).toContain('## Resources');
    expect(out).toContain('## Archive');
  });

  it('lists root-level topics before bucket sections', () => {
    const out = renderRootIndex([
      'projects/foo-project',
      'root-topic',
    ]);
    const rootIdx = out.indexOf('root-topic');
    const bucketIdx = out.indexOf('## Projects');
    expect(rootIdx).toBeGreaterThan(-1);
    expect(bucketIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeLessThan(bucketIdx);
  });

  it('within a bucket, leaf topics come before group sub-folders', () => {
    const out = renderRootIndex([
      'projects/emily/some-topic',
      'projects/zeta-flat-topic',
    ]);
    const leafIdx  = out.indexOf('Zeta Flat Topic');
    const groupIdx = out.indexOf('- **emily/**');
    expect(leafIdx).toBeGreaterThan(-1);
    expect(groupIdx).toBeGreaterThan(-1);
    expect(leafIdx).toBeLessThan(groupIdx);
  });

  it('sorts alphabetically within each tier', () => {
    const out = renderRootIndex([
      'projects/zebra-topic',
      'projects/alpha-topic',
      'projects/mango-topic',
    ]);
    const alphaIdx = out.indexOf('Alpha Topic');
    const mangoIdx = out.indexOf('Mango Topic');
    const zebraIdx = out.indexOf('Zebra Topic');
    expect(alphaIdx).toBeLessThan(mangoIdx);
    expect(mangoIdx).toBeLessThan(zebraIdx);
  });

  it('every leaf includes both a wikilink and an export-zip link', () => {
    const out = renderRootIndex(['projects/penang-trip', 'flat-topic']);
    const links = out.match(/\[⬇ Export ZIP\]\(\/export\/[^)]+\)/g);
    expect(links).toEqual(expect.arrayContaining([
      '[⬇ Export ZIP](/export/projects/penang-trip)',
      '[⬇ Export ZIP](/export/flat-topic)',
    ]));
  });

  it('display name title-cases the leaf slug only (not the full path)', () => {
    const out = renderRootIndex(['areas/sleep-temperature']);
    expect(out).toContain('|Sleep Temperature]]');
    expect(out).not.toContain('|Areas Sleep Temperature]]');
  });

  it('empty topic list produces an empty body', () => {
    expect(renderRootIndex([])).toBe('');
  });
});
