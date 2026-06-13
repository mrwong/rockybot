'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const { getPublishedTopics } = require('./quartz-builder');
const { buildTopicExport, buildMultiExport } = require('./export-builder');
const logger = require('./logger');

const { version } = require('../package.json');
const VERSION_BODY = JSON.stringify({ version });

// Lowercase letters, digits, hyphens; forward slashes allowed only as segment separators
// between non-empty segments (one slash at a time, no leading/trailing/duplicate).
// Blocks ../, encoded traversal, null bytes.
const SLUG_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

// Upper bound on topics per multi-export request — caps the work a single request
// can trigger and keeps the download a sane size.
const MAX_EXPORT_TOPICS = 25;

// Tracks in-progress exports to prevent duplicate concurrent builds
const inProgress = new Set();

// Validates a slug against all gates. Returns an HTTP status to fail with, or null
// if the slug is exportable. `published` is fetched once per request and passed in.
function slugFailureStatus(slug, published, quartzOutput) {
  if (!SLUG_RE.test(slug)) return 404;              // format
  if (!published.includes(slug)) return 404;        // publish whitelist
  if (!fs.existsSync(path.join(quartzOutput, slug))) return 503; // not yet built
  return null;
}

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

    const reqUrl = new URL(req.url, 'http://localhost');

    // Multi-topic export: /export?slugs=a,b,projects/c
    if (reqUrl.pathname === '/export') {
      const slugs = [...new Set(
        (reqUrl.searchParams.get('slugs') || '')
          .split(',').map(s => s.trim()).filter(Boolean)
      )];

      if (slugs.length === 0) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      if (slugs.length > MAX_EXPORT_TOPICS) {
        res.writeHead(400);
        res.end(`Too many topics — limit is ${MAX_EXPORT_TOPICS}`);
        return;
      }

      // All-or-nothing validation (publish list fetched fresh, never cached)
      const published = getPublishedTopics(vaultPath);
      for (const slug of slugs) {
        const status = slugFailureStatus(slug, published, quartzOutput);
        if (status) {
          res.writeHead(status);
          res.end(status === 503 ? 'Topic not yet built — try again in a moment' : 'Not Found');
          return;
        }
      }

      const key = `multi:${[...slugs].sort().join(',')}`;
      if (inProgress.has(key)) {
        res.writeHead(429);
        res.end('Export already in progress for this selection — try again shortly');
        return;
      }
      inProgress.add(key);
      req.on('close', () => inProgress.delete(key));

      try {
        logger.info(`Export: start ${key}`);
        await buildMultiExport(quartzOutput, slugs, res);
        logger.info(`Export: done  ${key}`);
      } catch (err) {
        logger.error(`Export: failed ${key}`, err.message);
        if (!res.writableEnded) {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        }
      } finally {
        inProgress.delete(key);
      }
      return;
    }

    const match = reqUrl.pathname.match(/^\/export\/(.+)$/);
    if (!match) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    let rawSlug;
    try {
      rawSlug = decodeURIComponent(match[1]);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

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
