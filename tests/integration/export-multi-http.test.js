'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// Mock the builders so HTTP tests don't need real Quartz output.
jest.mock('../../services/obsidian-bridge/src/export-builder', () => ({
  buildTopicExport: jest.fn((q, slug, res) => new Promise((resolve) => {
    res.writeHead(200, { 'Content-Type': 'application/zip' });
    res.end('ZIP_STUB');
    resolve();
  })),
  buildMultiExport: jest.fn((q, slugs, res) => new Promise((resolve) => {
    res.writeHead(200, { 'Content-Type': 'application/zip' });
    res.end('ZIP_STUB');
    resolve();
  })),
}));

const { createExportServer } = require('../../services/obsidian-bridge/src/http-server');
const { buildTopicExport, buildMultiExport } =
  require('../../services/obsidian-bridge/src/export-builder');

function request(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method, path: urlPath },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
    req.on('error', reject);
    req.end();
  });
}

let tmpDir, vaultPath, quartzOutput, server;

beforeAll(() => new Promise((resolve) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockybot-multi-http-'));
  vaultPath = path.join(tmpDir, 'vault');
  quartzOutput = path.join(tmpDir, 'quartz-output');

  const publish = (rel, value, built = true) => {
    const dir = path.join(vaultPath, 'research', ...rel.split('/'));
    fs.mkdirpSync(dir);
    fs.writeFileSync(path.join(dir, 'index.md'), `---\npublish: ${value}\n---\n`);
    if (built) fs.mkdirpSync(path.join(quartzOutput, ...rel.split('/')));
  };

  publish('valid-topic', true);
  publish('projects/penang-trip', true);      // nested + built
  publish('draft-topic', false);              // unpublished
  publish('unbuilt-topic', true, false);      // published but no quartz output

  server = createExportServer(0, quartzOutput, vaultPath);
  server.on('listening', resolve);
}));

afterAll((done) => { server.close(() => { fs.removeSync(tmpDir); done(); }); });

beforeEach(() => jest.clearAllMocks());

describe('multi-export: happy path', () => {
  it('?slugs=valid-topic → 200, buildMultiExport called with [valid-topic]', async () => {
    const res = await request(server, 'GET', '/export?slugs=valid-topic');
    expect(res.status).toBe(200);
    expect(buildMultiExport).toHaveBeenCalledWith(quartzOutput, ['valid-topic'], expect.anything());
  });

  it('multiple valid (incl. nested) → 200 with both slugs', async () => {
    const res = await request(server, 'GET', '/export?slugs=valid-topic,projects/penang-trip');
    expect(res.status).toBe(200);
    expect(buildMultiExport).toHaveBeenCalledWith(
      quartzOutput, ['valid-topic', 'projects/penang-trip'], expect.anything());
  });

  it('deduplicates repeated slugs', async () => {
    const res = await request(server, 'GET', '/export?slugs=valid-topic,valid-topic');
    expect(res.status).toBe(200);
    expect(buildMultiExport).toHaveBeenCalledWith(quartzOutput, ['valid-topic'], expect.anything());
  });
});

describe('multi-export: validation gates', () => {
  it('empty slugs → 404', async () => {
    const res = await request(server, 'GET', '/export?slugs=');
    expect(res.status).toBe(404);
    expect(buildMultiExport).not.toHaveBeenCalled();
  });

  it('missing slugs param → 404', async () => {
    const res = await request(server, 'GET', '/export');
    expect(res.status).toBe(404);
    expect(buildMultiExport).not.toHaveBeenCalled();
  });

  it('any invalid-format slug → 404, builder not called', async () => {
    const res = await request(server, 'GET', '/export?slugs=valid-topic,UPPER');
    expect(res.status).toBe(404);
    expect(buildMultiExport).not.toHaveBeenCalled();
  });

  it('any unpublished slug → 404, builder not called', async () => {
    const res = await request(server, 'GET', '/export?slugs=valid-topic,draft-topic');
    expect(res.status).toBe(404);
    expect(buildMultiExport).not.toHaveBeenCalled();
  });

  it('published-but-unbuilt slug → 503', async () => {
    const res = await request(server, 'GET', '/export?slugs=valid-topic,unbuilt-topic');
    expect(res.status).toBe(503);
    expect(buildMultiExport).not.toHaveBeenCalled();
  });

  it('over the topic cap → 400', async () => {
    const many = Array.from({ length: 26 }, (_, i) => `t-${i}`).join(',');
    const res = await request(server, 'GET', `/export?slugs=${many}`);
    expect(res.status).toBe(400);
    expect(buildMultiExport).not.toHaveBeenCalled();
  });
});

describe('multi-export: concurrency guard', () => {
  it('429 on concurrent request for the same selection', async () => {
    let release;
    buildMultiExport.mockImplementationOnce((_, __, res) => new Promise((resolve) => {
      release = () => { res.end(); resolve(); };
    }));
    const first = request(server, 'GET', '/export?slugs=valid-topic,projects/penang-trip');
    await new Promise(r => setTimeout(r, 20));
    // Same set, different order → same key → blocked
    const second = await request(server, 'GET', '/export?slugs=projects/penang-trip,valid-topic');
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });
});

describe('single-topic route still works (regression)', () => {
  it('GET /export/valid-topic → 200 via buildTopicExport', async () => {
    const res = await request(server, 'GET', '/export/valid-topic');
    expect(res.status).toBe(200);
    expect(buildTopicExport).toHaveBeenCalledWith(quartzOutput, 'valid-topic', expect.anything());
    expect(buildMultiExport).not.toHaveBeenCalled();
  });

  it('GET /export/projects/penang-trip (nested) → 200', async () => {
    const res = await request(server, 'GET', '/export/projects/penang-trip');
    expect(res.status).toBe(200);
    expect(buildTopicExport).toHaveBeenCalledWith(quartzOutput, 'projects/penang-trip', expect.anything());
  });
});
