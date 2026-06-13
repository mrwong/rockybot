'use strict';

const fs   = require('fs-extra');
const path = require('path');
const os   = require('os');

let tmpScaffold;
let tmpVault;
let seedVault;

beforeEach(async () => {
  tmpScaffold = await fs.mkdtemp(path.join(os.tmpdir(), 'rockybot-scaffold-'));
  tmpVault    = await fs.mkdtemp(path.join(os.tmpdir(), 'rockybot-vault-'));
  process.env._TEST_SCAFFOLD_DIR = tmpScaffold;
  jest.resetModules();
  ({ seedVault } = require('../../services/bot/src/seeder'));
});

afterEach(async () => {
  await fs.remove(tmpScaffold);
  await fs.remove(tmpVault);
  delete process.env._TEST_SCAFFOLD_DIR;
});

async function writeScaffold(relPath, content) {
  const full = path.join(tmpScaffold, relPath);
  await fs.ensureDir(path.dirname(full));
  await fs.writeFile(full, content);
}

async function writeVault(relPath, content) {
  const full = path.join(tmpVault, relPath);
  await fs.ensureDir(path.dirname(full));
  await fs.writeFile(full, content);
}

async function readVault(relPath) {
  return fs.readFile(path.join(tmpVault, relPath), 'utf8');
}

describe('seedVault', () => {
  it('copies missing files into the vault', async () => {
    await writeScaffold('research/index.md', '# Research\n');
    await writeScaffold('research/research-prompt.md', '# Research Prompt scaffold\n');

    await seedVault(tmpVault);

    expect(await readVault('research/index.md')).toBe('# Research\n');
    expect(await readVault('research/research-prompt.md')).toBe('# Research Prompt scaffold\n');
  });

  it('does not overwrite existing user-owned files (non-prompt)', async () => {
    await writeScaffold('research/index.md', '# Scaffold index\n');
    await writeVault('research/index.md', '# My customized index\n');

    await seedVault(tmpVault);

    expect(await readVault('research/index.md')).toBe('# My customized index\n');
  });

  it('overwrites prompt files when scaffold differs, backing up the live copy', async () => {
    await writeScaffold('research/research-prompt.md', 'scaffold v2\n');
    await writeVault('research/research-prompt.md', 'old live v1\n');

    await seedVault(tmpVault);

    expect(await readVault('research/research-prompt.md')).toBe('scaffold v2\n');

    const backups = await fs.readdir(path.join(tmpVault, 'research/.prompts-backup'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^research-prompt-\d{8}-\d{6}\.md$/);

    const backupContent = await fs.readFile(path.join(tmpVault, 'research/.prompts-backup', backups[0]), 'utf8');
    expect(backupContent).toBe('old live v1\n');
  });

  it('does not back up or overwrite prompt files when scaffold matches', async () => {
    const content = 'identical content\n';
    await writeScaffold('research/amend-prompt.md', content);
    await writeVault('research/amend-prompt.md', content);

    await seedVault(tmpVault);

    expect(await readVault('research/amend-prompt.md')).toBe(content);
    expect(await fs.pathExists(path.join(tmpVault, 'research/.prompts-backup'))).toBe(false);
  });

  it('backs up multiple drifted prompts in one run', async () => {
    await writeScaffold('research/research-prompt.md', 'new research\n');
    await writeScaffold('research/amend-prompt.md',    'new amend\n');
    await writeVault('research/research-prompt.md',    'old research\n');
    await writeVault('research/amend-prompt.md',       'old amend\n');

    await seedVault(tmpVault);

    expect(await readVault('research/research-prompt.md')).toBe('new research\n');
    expect(await readVault('research/amend-prompt.md')).toBe('new amend\n');

    const backups = await fs.readdir(path.join(tmpVault, 'research/.prompts-backup'));
    expect(backups).toHaveLength(2);
    expect(backups.some((n) => n.startsWith('research-prompt-'))).toBe(true);
    expect(backups.some((n) => n.startsWith('amend-prompt-'))).toBe(true);
  });

  it('skips silently when the scaffold dir does not exist', async () => {
    await fs.remove(tmpScaffold);
    await expect(seedVault(tmpVault)).resolves.not.toThrow();
    const exists = await fs.pathExists(path.join(tmpVault, 'research'));
    expect(exists).toBe(false);
  });

  it('seeds nested scaffold directories', async () => {
    await writeScaffold('research/topic-x/index.md', '# Topic X\n');
    await writeScaffold('research/topic-x/sub.md',   '# Sub\n');

    await seedVault(tmpVault);

    expect(await readVault('research/topic-x/index.md')).toBe('# Topic X\n');
    expect(await readVault('research/topic-x/sub.md')).toBe('# Sub\n');
  });
});
