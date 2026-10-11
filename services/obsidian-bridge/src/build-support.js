'use strict';

// Helpers for quartz-builder.js: decide whether a rebuild is needed, publish
// the staging dir to the output dir without rewriting unchanged files, and read
// the debounce settings. Kept free of Quartz so they can be tested offline.

const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs-extra');

// Fingerprint of a directory tree: sha256 over sorted (relative path, content
// hash) pairs. Covers edits, additions, deletions and renames. The content dir
// holds only published topics (a few MB) on container-local disk, so hashing it
// costs reads only; nothing is written to the pool.
function fingerprintDir(dir) {
  const entries = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { entries.push(`d ${r}`); walk(path.join(d, e.name), r); }
      else if (e.isFile()) {
        const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(d, e.name))).digest('hex');
        entries.push(`f ${r} ${h}`);
      }
    }
  })(dir, '');
  return crypto.createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}

// Remembers the fingerprint of the last *successful* build. In memory only, so
// the first build after process start always runs. A failed build never calls
// markBuilt, so it cannot suppress the next attempt.
function createBuildGate() {
  let last = null;
  return {
    needsBuild(fp) { return last === null || fp !== last; },
    markBuilt(fp) { last = fp; },
    reset() { last = null; },
  };
}

// Publish stageDir -> outDir. Checksum compare (-c) so identical files are not
// rewritten even though their mtimes differ; --delete propagates removals
// (.last-built is protected). Modes are set during the copy; a final targeted
// pass fixes only entries still not world-readable / world-searchable (NFS ACLs).
function publishStage(stageDir, outDir) {
  execFileSync('rsync', [
    '-rlc', '--delete', '--exclude=/.last-built',
    '--chmod=D755,F644', `${stageDir}/`, `${outDir}/`,
  ], { stdio: 'inherit' });
  execFileSync('find', [outDir, '-type', 'f', '!', '-perm', '-o=r', '-exec', 'chmod', 'o+r', '{}', '+'], { stdio: 'inherit' });
  execFileSync('find', [outDir, '-type', 'd', '!', '-perm', '-o=rx', '-exec', 'chmod', 'o+rx', '{}', '+'], { stdio: 'inherit' });
}

// Write only when content differs, so an unchanged generated file keeps its
// mtime (Quartz derives sitemap/RSS dates from source mtimes).
function writeIfChanged(file, text) {
  try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch (e) { /* missing */ }
  fs.outputFileSync(file, text);
  return true;
}

function intEnv(name, def) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

// REBUILD_DEBOUNCE_MS (default 3000); REBUILD_MAX_WAIT_MS (default 0 = off):
// longest a burst of events may postpone a build.
function debounceConfig() {
  return { debounceMs: intEnv('REBUILD_DEBOUNCE_MS', 3000), maxWaitMs: intEnv('REBUILD_MAX_WAIT_MS', 0) };
}

module.exports = { fingerprintDir, createBuildGate, publishStage, debounceConfig, writeIfChanged };
