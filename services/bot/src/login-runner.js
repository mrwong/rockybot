'use strict';

const { spawn } = require('child_process');
const logger = require('./logger');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const URL_PATTERN = /https?:\/\/\S+/;
const CAPTURE_TIMEOUT_MS = 15_000;

// Spawns `claude login` headlessly and resolves with the OAuth URL printed to
// stdout/stderr, plus the still-running process handle so the caller can kill it
// once the decision is made.  Rejects if no URL appears within 15 seconds.
function startLogin() {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let resolved = false;

    const scan = (chunk) => {
      if (resolved) return;
      const text = chunk.toString();
      const match = text.match(URL_PATTERN);
      if (match) {
        resolved = true;
        clearTimeout(timer);
        logger.info(`login-runner: captured OAuth URL from claude login`);
        resolve({ url: match[0], proc });
      }
    };

    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);

    proc.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timer); reject(err); }
    });

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`claude login exited (${code}) without printing an OAuth URL`));
      }
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error('Timed out waiting for claude login to print an OAuth URL'));
      }
    }, CAPTURE_TIMEOUT_MS);
  });
}

module.exports = { startLogin };
