'use strict';

const path = require('path');
const fs   = require('fs-extra');
const os   = require('os');
const { scanTopics, diffTopics } = require('../../services/bot/src/relink-watcher');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResearch(tmpDir, topics) {
  // topics: array of relative paths like 'projects/china-vacation'
  for (const t of topics) {
    const dir = path.join(tmpDir, 'research', t);
    fs.mkdirpSync(dir);
    fs.writeFileSync(path.join(dir, 'index.md'), `---\ntitle: ${t}\n---\n`);
  }
}

// ---------------------------------------------------------------------------
// scanTopics
// ---------------------------------------------------------------------------

describe('scanTopics', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relink-'));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('returns empty array when research dir is empty', () => {
    const researchDir = path.join(tmpDir, 'research');
    fs.mkdirpSync(researchDir);
    expect(scanTopics(researchDir, '')).toEqual([]);
  });

  it('finds a flat topic', () => {
    makeResearch(tmpDir, ['solar-california-oakland']);
    const researchDir = path.join(tmpDir, 'research');
    expect(scanTopics(researchDir, '')).toContain('solar-california-oakland');
  });

  it('finds a nested topic at two levels', () => {
    makeResearch(tmpDir, ['projects/china-vacation-2026']);
    const researchDir = path.join(tmpDir, 'research');
    expect(scanTopics(researchDir, '')).toContain('projects/china-vacation-2026');
  });

  it('finds a topic at three levels deep', () => {
    makeResearch(tmpDir, ['areas/family/autism-resources-oakland']);
    const researchDir = path.join(tmpDir, 'research');
    expect(scanTopics(researchDir, '')).toContain('areas/family/autism-resources-oakland');
  });

  it('skips inbox/ at top level', () => {
    const inboxDir = path.join(tmpDir, 'research', 'inbox', 'pending-topic');
    fs.mkdirpSync(inboxDir);
    fs.writeFileSync(path.join(inboxDir, 'index.md'), '---\ntitle: pending\n---\n');
    const researchDir = path.join(tmpDir, 'research');
    expect(scanTopics(researchDir, '')).toEqual([]);
  });

  it('skips .trash/ at any level', () => {
    const trashDir = path.join(tmpDir, 'research', '.trash', 'deleted-topic');
    fs.mkdirpSync(trashDir);
    fs.writeFileSync(path.join(trashDir, 'index.md'), '---\ntitle: deleted\n---\n');
    const researchDir = path.join(tmpDir, 'research');
    expect(scanTopics(researchDir, '')).toEqual([]);
  });

  it('does not include dirs without index.md but still recurses into them', () => {
    // bucket dir (projects/) has no index.md, topic inside does
    makeResearch(tmpDir, ['projects/real-topic']);
    // Verify bucket itself not returned, topic is
    const researchDir = path.join(tmpDir, 'research');
    const result = scanTopics(researchDir, '');
    expect(result).toContain('projects/real-topic');
    expect(result).not.toContain('projects');
  });
});

// ---------------------------------------------------------------------------
// diffTopics
// ---------------------------------------------------------------------------

describe('diffTopics', () => {
  it('returns zero moves when shapes are identical', () => {
    const topics = ['projects/china-vacation-2026', 'areas/ai-research/llm-research-bots'];
    const { moves } = diffTopics(topics, topics);
    expect(moves).toHaveLength(0);
  });

  it('returns zero moves on first run (empty old shape)', () => {
    const { moves } = diffTopics([], ['projects/china-vacation-2026']);
    expect(moves).toHaveLength(0);
  });

  it('detects a single topic move by basename match', () => {
    const old = ['areas/family/powerlifting-oakland'];
    const cur = ['archive/unsorted/powerlifting-oakland'];
    const { moves } = diffTopics(old, cur);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ from: 'areas/family/powerlifting-oakland', to: 'archive/unsorted/powerlifting-oakland' });
  });

  it('detects two simultaneous moves', () => {
    const old = ['areas/Financial/miles-activities-oakland', 'resources/Hobbies/custom-smokers'];
    const cur = ['areas/financial/miles-activities-oakland', 'resources/hobbies/custom-smokers'];
    const { moves } = diffTopics(old, cur);
    expect(moves).toHaveLength(2);
    expect(moves.map(m => m.from)).toContain('areas/Financial/miles-activities-oakland');
    expect(moves.map(m => m.from)).toContain('resources/Hobbies/custom-smokers');
  });

  it('does not treat a new topic (no prior basename) as a move', () => {
    const old = ['projects/china-vacation-2026'];
    const cur = ['projects/china-vacation-2026', 'projects/new-topic'];
    const { moves } = diffTopics(old, cur);
    expect(moves).toHaveLength(0);
  });

  it('does not treat a deleted topic (no matching basename in new) as a move', () => {
    const old = ['projects/china-vacation-2026', 'archive/hermeus'];
    const cur = ['projects/china-vacation-2026'];
    const { moves } = diffTopics(old, cur);
    expect(moves).toHaveLength(0);
  });

  it('handles 3-level path moves correctly', () => {
    const old = ['resources/Hobbies/Coffee/specialty-coffee-espresso'];
    const cur = ['resources/hobbies/coffee/specialty-coffee-espresso'];
    const { moves } = diffTopics(old, cur);
    expect(moves).toHaveLength(1);
    expect(moves[0].from).toBe('resources/Hobbies/Coffee/specialty-coffee-espresso');
    expect(moves[0].to).toBe('resources/hobbies/coffee/specialty-coffee-espresso');
  });

  it('does not double-match when two topics share a basename', () => {
    // Unlikely in practice but must not crash or produce duplicate matches
    const old = ['areas/family/solar', 'resources/tech/solar'];
    const cur = ['archive/old/solar'];
    const { moves } = diffTopics(old, cur);
    // Only one match is possible (one new path for two candidates)
    expect(moves).toHaveLength(1);
  });
});
