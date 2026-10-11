'use strict';

// Offline tests for the public garden: selection rule and copy step run against a
// real temporary fixture vault. No Quartz, no network, no Claude.

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const gb = require('../../services/obsidian-bridge/src/garden-builder');
const { runAllBuilds } = require('../../services/obsidian-bridge/src/quartz-builder');

let tmp, vault, content;

function write(rel, body) {
  const p = path.join(vault, 'research', rel);
  fs.outputFileSync(p, body);
}
function topic(rel, fm, body = '# t\n') {
  write(`${rel}/index.md`, fm === null ? body : `---\n${fm}\n---\n${body}`);
}
function listContent() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      e.isDirectory() ? walk(p) : out.push(path.relative(content, p));
    }
  })(content);
  return out.sort();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-test-'));
  vault = path.join(tmp, 'vault');
  content = path.join(tmp, 'content');
  fs.mkdirpSync(path.join(vault, 'research'));
  gb.resetGardenState();
});
afterEach(() => {
  fs.removeSync(tmp);
  delete process.env.GARDEN_OUTPUT;
});

describe('readGardenFlags', () => {
  const f = fm => gb.readGardenFlags(`---\n${fm}\n---\nbody\n`);
  it('both flags true', () => expect(f('publish: true\npublic: true')).toEqual({ publish: true, public: true }));
  it('only publish', () => expect(f('publish: true')).toEqual({ publish: true, public: false }));
  it('only public', () => expect(f('public: true')).toEqual({ publish: false, public: true }));
  it('false values', () => expect(f('publish: true\npublic: false').public).toBe(false));
  it('trailing comment ok', () => expect(f('publish: true\npublic: true # yes').public).toBe(true));
  it('quoted value is not true', () => expect(f('publish: true\npublic: "true"').public).toBe(false));
  it('duplicate keys fail closed', () => expect(f('publish: true\npublic: false\npublic: true').public).toBe(false));
  it('indented (nested) key ignored', () => expect(f('publish: true\nmeta:\n  public: true').public).toBe(false));
  it('public: true only in body is not public', () => {
    expect(gb.readGardenFlags('---\npublish: true\n---\npublic: true\n')).toEqual({ publish: true, public: false });
  });
  it('no frontmatter', () => expect(gb.readGardenFlags('publish: true\npublic: true\n')).toEqual({ publish: false, public: false }));
  it('unterminated frontmatter', () => expect(gb.readGardenFlags('---\npublish: true\npublic: true\n')).toEqual({ publish: false, public: false }));
  it('non-string input', () => expect(gb.readGardenFlags(null)).toEqual({ publish: false, public: false }));
  it('CRLF', () => expect(gb.readGardenFlags('---\r\npublish: true\r\npublic: true\r\n---\r\nx')).toEqual({ publish: true, public: true }));
});

describe('selectPublicTopics', () => {
  it('requires both flags and warns on public without publish', () => {
    topic('both', 'publish: true\npublic: true');
    topic('pub-only', 'publish: true');
    topic('public-only', 'public: true');
    topic('body-only', 'publish: true', 'public: true\n');
    topic('nofm', null, 'publish: true\npublic: true\n');
    const r = gb.selectPublicTopics(vault);
    expect(r.topics).toEqual(['both']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('public-only');
  });
  it('malformed frontmatter is not public', () => {
    topic('bad', 'publish: true\npublic: [true');
    write('unterminated/index.md', '---\npublish: true\npublic: true\n');
    expect(gb.selectPublicTopics(vault).topics).toEqual([]);
  });
  it('finds nested public topics under a non-public parent', () => {
    topic('projects/parent', 'publish: true');
    topic('projects/parent/child', 'publish: true\npublic: true');
    expect(gb.selectPublicTopics(vault).topics).toEqual(['projects/parent/child']);
  });
  it('ignores symlinked topic directories and symlinked index.md', () => {
    topic('real', 'publish: true\npublic: true');
    fs.symlinkSync(path.join(vault, 'research', 'real'), path.join(vault, 'research', 'linkdir'));
    fs.mkdirpSync(path.join(vault, 'research', 'x'));
    fs.symlinkSync(path.join(vault, 'research', 'real', 'index.md'), path.join(vault, 'research', 'x', 'index.md'));
    expect(gb.selectPublicTopics(vault).topics).toEqual(['real']);
  });
  it('skips inbox', () => {
    topic('inbox/foo', 'publish: true\npublic: true');
    expect(gb.selectPublicTopics(vault).topics).toEqual([]);
  });
  it('no research dir', () => {
    fs.removeSync(path.join(vault, 'research'));
    expect(gb.selectPublicTopics(vault).topics).toEqual([]);
  });
});

describe('syncGardenContent (real copy against fixture vault)', () => {
  it('public parent with non-public nested topic: child files absent', () => {
    topic('areas/parent', 'publish: true\npublic: true');
    write('areas/parent/page.md', 'page');
    topic('areas/parent/secret-child', 'publish: true');
    write('areas/parent/secret-child/private.md', 'PRIVATE');
    const r = gb.syncGardenContent(vault, content, null);
    expect(r.changed).toBe(true);
    expect(listContent()).toEqual(['areas/parent/index.md', 'areas/parent/page.md', 'index.md']);
  });

  it('public parent does not pull in a nested topic even if only publish: true', () => {
    topic('p', 'publish: true\npublic: true');
    topic('p/c', 'publish: true');
    gb.syncGardenContent(vault, content, null);
    expect(fs.existsSync(path.join(content, 'p', 'c'))).toBe(false);
  });

  it('public child under non-public parent: child present, parent files absent', () => {
    topic('areas/parent', 'publish: true');
    write('areas/parent/parent-only.md', 'PRIVATE');
    topic('areas/parent/child', 'publish: true\npublic: true');
    write('areas/parent/child/page.md', 'ok');
    gb.syncGardenContent(vault, content, null);
    expect(listContent()).toEqual(['areas/parent/child/index.md', 'areas/parent/child/page.md', 'index.md']);
  });

  it('plain subfolders (no index.md) are included, nested deeper too', () => {
    topic('t', 'publish: true\npublic: true');
    write('t/images/a.png', 'png');
    write('t/sub/deeper/b.md', 'b');
    gb.syncGardenContent(vault, content, null);
    expect(listContent()).toEqual(['index.md', 't/images/a.png', 't/index.md', 't/sub/deeper/b.md']);
  });

  it('symlinks (file and dir) inside a public folder are never copied or followed', () => {
    topic('t', 'publish: true\npublic: true');
    write('secret/private.md', 'PRIVATE');
    fs.outputFileSync(path.join(tmp, 'outside.txt'), 'OUTSIDE');
    fs.symlinkSync(path.join(vault, 'research', 'secret', 'private.md'), path.join(vault, 'research', 't', 'link.md'));
    fs.symlinkSync(path.join(vault, 'research', 'secret'), path.join(vault, 'research', 't', 'linkdir'));
    fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(vault, 'research', 't', 'out.txt'));
    gb.syncGardenContent(vault, content, null);
    expect(listContent()).toEqual(['index.md', 't/index.md']);
    expect(JSON.stringify(listContent())).not.toMatch(/link|secret|out/);
  });

  it('dotfiles and dot-directories are not copied', () => {
    topic('t', 'publish: true\npublic: true');
    write('t/.hidden', 'x');
    write('t/.obsidian/app.json', 'x');
    gb.syncGardenContent(vault, content, null);
    expect(listContent()).toEqual(['index.md', 't/index.md']);
  });

  it('root index lists public topics only and has no export links', () => {
    topic('pub', 'publish: true\npublic: true');
    topic('priv', 'publish: true');
    gb.syncGardenContent(vault, content, null);
    const idx = fs.readFileSync(path.join(content, 'index.md'), 'utf8');
    expect(idx).toContain('[[pub/index|Pub]]');
    expect(idx).not.toContain('priv');
    expect(idx.toLowerCase()).not.toContain('export');
  });

  it('zero public topics: content dir is empty, no index', () => {
    topic('priv', 'publish: true');
    fs.outputFileSync(path.join(content, 'stale.md'), 'stale');
    const r = gb.syncGardenContent(vault, content, null);
    expect(r.changed).toBe(true);
    expect(listContent()).toEqual([]);
  });

  it('unpublishing between two runs removes the files', () => {
    topic('t', 'publish: true\npublic: true');
    write('t/page.md', 'p');
    const r1 = gb.syncGardenContent(vault, content, null);
    expect(listContent()).toContain('t/page.md');
    topic('t', 'publish: true\npublic: false');
    const r2 = gb.syncGardenContent(vault, content, r1.fingerprint);
    expect(r2.changed).toBe(true);
    expect(listContent()).toEqual([]);
  });

  it('unchanged public content reports no change and writes nothing; private edits do not change it', () => {
    topic('t', 'publish: true\npublic: true');
    topic('priv', 'publish: true');
    const r1 = gb.syncGardenContent(vault, content, null);
    const marker = path.join(content, 't', 'index.md');
    const mtime1 = fs.statSync(marker).mtimeMs;
    write('priv/new.md', 'private edit');
    write('priv/index.md', '---\npublish: true\n---\nedited');
    const r2 = gb.syncGardenContent(vault, content, r1.fingerprint);
    expect(r2.changed).toBe(false);
    expect(r2.fingerprint).toBe(r1.fingerprint);
    expect(fs.statSync(marker).mtimeMs).toBe(mtime1);
  });

  it('editing a public file changes the fingerprint', () => {
    topic('t', 'publish: true\npublic: true');
    const r1 = gb.syncGardenContent(vault, content, null);
    write('t/new.md', 'x');
    const r2 = gb.syncGardenContent(vault, content, r1.fingerprint);
    expect(r2.changed).toBe(true);
    expect(listContent()).toContain('t/new.md');
  });
});

describe('runGardenBuild gating', () => {
  it('GARDEN_OUTPUT unset: disabled, no content dir, no output', () => {
    delete process.env.GARDEN_OUTPUT;
    topic('t', 'publish: true\npublic: true');
    const r = gb.runGardenBuild(vault, { contentDir: content, stageDir: path.join(tmp, 'stage') });
    expect(r.status).toBe('disabled');
    expect(fs.existsSync(content)).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'stage'))).toBe(false);
  });

  it('runAllBuilds with GARDEN_OUTPUT unset does no garden work', () => {
    delete process.env.GARDEN_OUTPUT;
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    runAllBuilds(vault, path.join(tmp, 'private-out'));
    const logs = spy.mock.calls.map(c => c.join(' ')).join('\n');
    spy.mockRestore();
    expect(logs).not.toContain('[garden]');
  });

  it('zero public topics publishes a placeholder and removes stale pages; unchanged rerun skips', () => {
    const out = path.join(tmp, 'garden-out');
    fs.outputFileSync(path.join(out, 'old', 'index.html'), 'stale public page');
    topic('priv', 'publish: true');
    const opts = { gardenOutput: out, contentDir: content, stageDir: path.join(tmp, 'stage') };
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(gb.runGardenBuild(vault, opts).status).toBe('built');
    expect(fs.existsSync(path.join(out, 'old'))).toBe(false);
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('Nothing is published');
    expect(gb.runGardenBuild(vault, opts).status).toBe('unchanged');
    spy.mockRestore();
  });
});
