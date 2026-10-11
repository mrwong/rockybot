'use strict';

// Offline tests for the obsidian-bridge rebuild gate and publish step.
// Quartz is stubbed via runBuild's opts.runQuartz; needs only rsync + find.

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const BRIDGE = path.join(__dirname, '../../services/obsidian-bridge/src');
let tmp, vault, qsrc, stage, out, builds, qb, bs;

const note = (rel, body, publish) =>
  fs.outputFileSync(path.join(vault, rel),
    `---\n${publish === undefined ? '' : `publish: ${publish}\n`}---\n${body}\n`);

// Stub Quartz: copy content/*.md to stage as .html, plus a root index.html
// with an article so injectExportUI works, plus a file that changes every run.
function fakeQuartz(dir) {
  builds.push(dir);
  fs.removeSync(dir);
  const content = path.join(qsrc, 'content');
  for (const f of require('glob').sync('**/*.md', { cwd: content })) {
    fs.outputFileSync(path.join(dir, f.replace(/\.md$/, '.html')),
      f === 'index.md' ? '<html><body><article>root</article></body></html>'
                       : fs.readFileSync(path.join(content, f), 'utf8'));
  }
  fs.outputFileSync(path.join(dir, 'sitemap.xml'), String(Date.now()) + Math.random());
}
const run = () => qb.runBuild(vault, out, { quartzSrc: qsrc, stageDir: stage, runQuartz: fakeQuartz });

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
  [vault, qsrc, stage, out] = ['vault', 'qsrc', 'stage', 'out'].map(d => path.join(tmp, d));
  fs.ensureDirSync(out); fs.ensureDirSync(path.join(qsrc, 'content'));
  builds = [];
  note('research/alpha/index.md', 'alpha', true);
  note('research/alpha/sub.md', 'sub');
  note('research/beta/index.md', 'beta', false);
  note('notes/other.md', 'other');
  qb = require(path.join(BRIDGE, 'quartz-builder.js'));
  bs = require(path.join(BRIDGE, 'build-support.js'));
});
afterEach(() => { jest.restoreAllMocks(); fs.removeSync(tmp); });

const snap = () => {
  const o = {};
  for (const f of require('glob').sync('**/*', { cwd: out, nodir: true, dot: true })) {
    const s = fs.statSync(path.join(out, f));
    o[f] = `${s.ino}:${s.mtimeMs}`;
  }
  return o;
};

describe('rebuild gate', () => {
  test('first run builds, unchanged second run does not touch output', () => {
    run();
    expect(builds).toHaveLength(1);
    const before = snap();
    run();
    expect(builds).toHaveLength(1);
    expect(snap()).toEqual(before);
    expect(before['.last-built']).toBeDefined();
  });

  test('unpublished note edit -> no build', () => {
    run();
    note('research/beta/index.md', 'beta changed', false);
    note('notes/other.md', 'changed');
    run();
    expect(builds).toHaveLength(1);
  });

  test('published note edit -> build', () => {
    run();
    note('research/alpha/sub.md', 'sub changed');
    run();
    expect(builds).toHaveLength(2);
    expect(fs.readFileSync(path.join(out, 'alpha/sub.html'), 'utf8')).toContain('sub changed');
  });

  test('publish flag flipped on then off -> build each time', () => {
    run();
    note('research/beta/index.md', 'beta', true);
    run();
    expect(builds).toHaveLength(2);
    expect(fs.existsSync(path.join(out, 'beta/index.html'))).toBe(true);
    note('research/beta/index.md', 'beta', false);
    run();
    expect(builds).toHaveLength(3);
    expect(fs.existsSync(path.join(out, 'beta'))).toBe(false);
  });

  test('topic deleted -> build and output removed', () => {
    run();
    fs.removeSync(path.join(vault, 'research/alpha'));
    note('research/beta/index.md', 'beta', true);
    run();
    expect(builds).toHaveLength(2);
    expect(fs.existsSync(path.join(out, 'alpha'))).toBe(false);
  });

  test('failed build does not suppress the next build', () => {
    qb.runBuild(vault, out, { quartzSrc: qsrc, stageDir: stage, runQuartz: () => { throw new Error('boom'); } });
    expect(fs.existsSync(path.join(out, '.last-built'))).toBe(false);
    run();
    expect(builds).toHaveLength(1);
    expect(fs.existsSync(path.join(out, '.last-built'))).toBe(true);
  });

  test('failure after a good build: retry builds even with same content', () => {
    run();
    note('research/alpha/sub.md', 'v2');
    qb.runBuild(vault, out, { quartzSrc: qsrc, stageDir: stage, runQuartz: () => { throw new Error('boom'); } });
    run();
    expect(builds).toHaveLength(2);
    expect(fs.readFileSync(path.join(out, 'alpha/sub.html'), 'utf8')).toContain('v2');
  });

  test('injected export UI is present after build and survives a skipped build', () => {
    run();
    const idx = path.join(out, 'index.html');
    expect(fs.readFileSync(idx, 'utf8')).toContain('export-multi');
    run();
    expect(fs.readFileSync(idx, 'utf8')).toContain('export-multi');
  });
});

describe('publishStage', () => {
  test('unchanged file keeps inode+mtime, changed rewritten, deleted removed, modes servable', () => {
    fs.outputFileSync(path.join(stage, 'a.html'), 'same');
    fs.outputFileSync(path.join(stage, 'd/b.html'), 'one');
    fs.outputFileSync(path.join(stage, 'gone.html'), 'x');
    bs.publishStage(stage, out);
    fs.outputFileSync(path.join(out, '.last-built'), 'marker');
    const a = fs.statSync(path.join(out, 'a.html'));
    // new stage with fresh mtimes
    fs.removeSync(stage);
    fs.outputFileSync(path.join(stage, 'a.html'), 'same');
    fs.outputFileSync(path.join(stage, 'd/b.html'), 'two');
    bs.publishStage(stage, out);
    const a2 = fs.statSync(path.join(out, 'a.html'));
    expect([a2.ino, a2.mtimeMs]).toEqual([a.ino, a.mtimeMs]);
    expect(fs.readFileSync(path.join(out, 'd/b.html'), 'utf8')).toBe('two');
    expect(fs.existsSync(path.join(out, 'gone.html'))).toBe(false);
    expect(fs.readFileSync(path.join(out, '.last-built'), 'utf8')).toBe('marker');
    expect(fs.statSync(path.join(out, 'a.html')).mode & 0o004).toBeTruthy();
    expect(fs.statSync(path.join(out, 'd')).mode & 0o005).toBe(0o005);
  });

  test('restrictive source modes end up world-readable', () => {
    fs.outputFileSync(path.join(stage, 'p/q.html'), 'x');
    fs.chmodSync(path.join(stage, 'p/q.html'), 0o600);
    fs.chmodSync(path.join(stage, 'p'), 0o700);
    bs.publishStage(stage, out);
    expect(fs.statSync(path.join(out, 'p/q.html')).mode & 0o777).toBe(0o644);
    expect(fs.statSync(path.join(out, 'p')).mode & 0o777).toBe(0o755);
  });
});

describe('debounce config', () => {
  const save = { ...process.env };
  afterEach(() => { process.env = { ...save }; });
  test('defaults unchanged', () => {
    delete process.env.REBUILD_DEBOUNCE_MS; delete process.env.REBUILD_MAX_WAIT_MS;
    expect(bs.debounceConfig()).toEqual({ debounceMs: 3000, maxWaitMs: 0 });
  });
  test('env overrides, invalid ignored', () => {
    process.env.REBUILD_DEBOUNCE_MS = '60000'; process.env.REBUILD_MAX_WAIT_MS = 'abc';
    expect(bs.debounceConfig()).toEqual({ debounceMs: 60000, maxWaitMs: 0 });
  });
  test('max wait forces a build during a continuous burst', () => {
    jest.useFakeTimers();
    process.env.REBUILD_DEBOUNCE_MS = '1000'; process.env.REBUILD_MAX_WAIT_MS = '2500';
    // runBuild is internal; with no research dir it just warns, so observe timers
    const spy = jest.spyOn(global, 'setTimeout');
    qb.scheduleRebuild(path.join(tmp, "nope"), out);
    for (let i = 0; i < 5; i++) { jest.advanceTimersByTime(800); qb.scheduleRebuild(path.join(tmp, "nope"), out); }
    const waits = spy.mock.calls.map(c => c[1]);
    expect(waits[0]).toBe(1000);
    expect(Math.min(...waits)).toBeLessThan(1000); // later waits clamp toward the max-wait deadline
    jest.useRealTimers();
  });
});
