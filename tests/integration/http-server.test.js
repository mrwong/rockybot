'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// Mock buildTopicExport so the HTTP tests don't need a real Quartz output.
// The mock writes a minimal valid response so the server can complete normally.
jest.mock('../../services/obsidian-bridge/src/export-builder', () => ({
  buildTopicExport: jest.fn((quartzOutput, slug, res) => {
    return new Promise((resolve) => {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end('ZIP_STUB');
      resolve();
    });
  }),
}));

const { createExportServer } = require('../../services/obsidian-bridge/src/http-server');
const { buildTopicExport } = require('../../services/obsidian-bridge/src/export-builder');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function request(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method, path: urlPath },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString(),
        }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fixture vault + quartz output
// ---------------------------------------------------------------------------

let tmpDir, vaultPath, quartzOutput, server;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockybot-http-'));
  vaultPath = path.join(tmpDir, 'vault');
  quartzOutput = path.join(tmpDir, 'quartz-output');

  // Published topic
  const pubDir = path.join(vaultPath, 'research', 'valid-topic');
  fs.mkdirpSync(pubDir);
  fs.writeFileSync(path.join(pubDir, 'index.md'), '---\npublish: true\n---\n');

  // Unpublished topic
  const draftDir = path.join(vaultPath, 'research', 'draft-topic');
  fs.mkdirpSync(draftDir);
  fs.writeFileSync(path.join(draftDir, 'index.md'), '---\npublish: false\n---\n');

  // Quartz output exists for valid-topic (but not draft-topic)
  fs.mkdirpSync(path.join(quartzOutput, 'valid-topic'));

  server = createExportServer(0, quartzOutput, vaultPath); // port 0 = random
});

afterAll((done) => {
  server.close(() => {
    fs.removeSync(tmpDir);
    done();
  });
});

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('http-server: routing', () => {
  it('GET /export/valid-topic → 200 and calls buildTopicExport', async () => {
    const res = await request(server, 'GET', '/export/valid-topic');
    expect(res.status).toBe(200);
    expect(buildTopicExport).toHaveBeenCalledWith(
      quartzOutput, 'valid-topic', expect.anything()
    );
  });

  it('GET / → 404', async () => {
    const res = await request(server, 'GET', '/');
    expect(res.status).toBe(404);
  });

  it('GET /export/ (no slug) → 404', async () => {
    const res = await request(server, 'GET', '/export/');
    expect(res.status).toBe(404);
  });

  it('POST /export/valid-topic → 405', async () => {
    const res = await request(server, 'POST', '/export/valid-topic');
    expect(res.status).toBe(405);
  });
});

describe('http-server: slug format gate', () => {
  it('rejects path traversal: /export/../etc/passwd → 404', async () => {
    const res = await request(server, 'GET', '/export/../etc/passwd');
    expect(res.status).toBe(404);
    expect(buildTopicExport).not.toHaveBeenCalled();
  });

  it('rejects uppercase slug: /export/UPPERCASE → 404', async () => {
    const res = await request(server, 'GET', '/export/UPPERCASE');
    expect(res.status).toBe(404);
    expect(buildTopicExport).not.toHaveBeenCalled();
  });

  it('rejects slug with spaces or special chars → 404', async () => {
    const res = await request(server, 'GET', '/export/my%20topic');
    expect(res.status).toBe(404);
    expect(buildTopicExport).not.toHaveBeenCalled();
  });

  it('rejects slug with underscore → 404', async () => {
    const res = await request(server, 'GET', '/export/my_topic');
    expect(res.status).toBe(404);
    expect(buildTopicExport).not.toHaveBeenCalled();
  });
});

describe('http-server: publish whitelist gate', () => {
  it('rejects unpublished topic → 404', async () => {
    const res = await request(server, 'GET', '/export/draft-topic');
    expect(res.status).toBe(404);
    expect(buildTopicExport).not.toHaveBeenCalled();
  });

  it('rejects topic not in vault at all → 404', async () => {
    const res = await request(server, 'GET', '/export/nonexistent-topic');
    expect(res.status).toBe(404);
    expect(buildTopicExport).not.toHaveBeenCalled();
  });
});

describe('http-server: quartz output existence gate', () => {
  it('returns 503 when topic is published but quartz output missing', async () => {
    // valid-topic IS published but we temporarily remove its quartz dir
    const qDir = path.join(quartzOutput, 'valid-topic');
    fs.removeSync(qDir);
    try {
      const res = await request(server, 'GET', '/export/valid-topic');
      expect(res.status).toBe(503);
      expect(buildTopicExport).not.toHaveBeenCalled();
    } finally {
      fs.mkdirpSync(qDir); // restore for other tests
    }
  });
});

describe('http-server: concurrency guard', () => {
  it('returns 429 on concurrent request for same slug', async () => {
    // Make buildTopicExport hang until we release it
    let releaseExport;
    buildTopicExport.mockImplementationOnce((_, __, res) => new Promise((resolve) => {
      releaseExport = () => { res.end(); resolve(); };
    }));

    // Fire first request (will hang)
    const first = request(server, 'GET', '/export/valid-topic');

    // Give the server a tick to register the in-progress lock
    await new Promise(r => setTimeout(r, 20));

    // Second request should be rejected
    const second = await request(server, 'GET', '/export/valid-topic');
    expect(second.status).toBe(429);

    // Release the first
    releaseExport();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
  });
});
