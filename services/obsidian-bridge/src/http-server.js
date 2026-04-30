'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const { getPublishedTopics } = require('./quartz-builder');
const { buildTopicExport } = require('./export-builder');
const logger = require('./logger');

const { version } = require('../package.json');
const VERSION_BODY = JSON.stringify({ version });

// Only lowercase letters, digits, and hyphens — blocks ../, encoded traversal, null bytes
const SLUG_RE = /^[a-z0-9-]+$/;

// Tracks in-progress exports to prevent duplicate concurrent builds
const inProgress = new Set();

function createExportServer(port, quartzOutput, vaultPath) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    if (req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(VERSION_BODY);
      return;
    }

    const match = req.url.match(/^\/export\/([^/?#]+)$/);
    if (!match) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const rawSlug = match[1];

    // 1. Format gate — before any filesystem access
    if (!SLUG_RE.test(rawSlug)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 2. Whitelist gate — reads vault fresh every request (never cached)
    const published = getPublishedTopics(vaultPath);
    if (!published.includes(rawSlug)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 3. Quartz output must exist (topic may be published but not yet built)
    const topicDir = path.join(quartzOutput, rawSlug);
    if (!fs.existsSync(topicDir)) {
      res.writeHead(503);
      res.end('Topic not yet built — try again in a moment');
      return;
    }

    // 4. Concurrency guard
    if (inProgress.has(rawSlug)) {
      res.writeHead(429);
      res.end('Export already in progress for this topic — try again shortly');
      return;
    }

    inProgress.add(rawSlug);
    // Release lock on client disconnect so a browser navigation/timeout
    // doesn't leave the slot permanently occupied
    req.on('close', () => inProgress.delete(rawSlug));

    try {
      logger.info(`Export: start ${rawSlug}`);
      await buildTopicExport(quartzOutput, rawSlug, res);
      logger.info(`Export: done  ${rawSlug}`);
    } catch (err) {
      logger.error(`Export: failed ${rawSlug}`, err.message);
      if (!res.writableEnded) {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    } finally {
      inProgress.delete(rawSlug);
    }
  });

  server.listen(port, '0.0.0.0');
  return server;
}

module.exports = { createExportServer };
