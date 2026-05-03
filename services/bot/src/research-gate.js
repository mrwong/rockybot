'use strict';

const path   = require('path');
const fs     = require('fs-extra');
const logger = require('./logger');

const VAULT_PATH      = process.env.VAULT_PATH || '/vault';
const HOLD_FILE       = path.join(VAULT_PATH, 'research', '.research-hold');
const MIN_INTERVAL_MS = (parseInt(process.env.RESEARCH_MIN_INTERVAL_MINUTES || '0', 10)) * 60 * 1000;

// Parse "HH:MM-HH:MM" → { startMins, endMins } in minutes-since-midnight UTC.
// Returns null if blank, equal start/end (disabled), or unparseable (warn + disable).
function parseQuietHours(raw) {
  if (!raw || !raw.trim()) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) {
    logger.warn(`research-gate: RESEARCH_QUIET_HOURS="${raw}" is not valid (expected HH:MM-HH:MM) — quiet hours disabled`);
    return null;
  }
  const startMins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const endMins   = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (startMins === endMins) return null;
  return { startMins, endMins };
}

const QUIET_HOURS = parseQuietHours(process.env.RESEARCH_QUIET_HOURS || '');

// In-memory pacing state — reset on restart, which is intentional.
let lastResearchCompletionMs = 0;

// Basenames of items already notified during quiet hours — prevents re-notifying
// on every poll cycle while items sit in queue.
const notifiedItems = new Set();

// ---- Hold file ---------------------------------------------------------------

function isHoldActive() {
  return fs.existsSync(HOLD_FILE);
}

async function setHold(active) {
  if (active) {
    await fs.outputFile(HOLD_FILE, '');
  } else {
    await fs.remove(HOLD_FILE);
  }
}

// ---- Quiet hours -------------------------------------------------------------

function isInQuietHours() {
  if (!QUIET_HOURS) return false;
  const now     = new Date();
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { startMins, endMins } = QUIET_HOURS;
  if (startMins > endMins) {
    // Midnight-spanning window (e.g. 22:00-06:00): suppress if now >= start OR now < end
    return nowMins >= startMins || nowMins < endMins;
  }
  return nowMins >= startMins && nowMins < endMins;
}

// ---- Pacing ------------------------------------------------------------------

function isWithinPacingInterval() {
  if (MIN_INTERVAL_MS === 0 || lastResearchCompletionMs === 0) return false;
  return (Date.now() - lastResearchCompletionMs) < MIN_INTERVAL_MS;
}

function recordResearchCompletion() {
  lastResearchCompletionMs = Date.now();
}

// ---- Notified items ----------------------------------------------------------

function markItemNotified(filename) {
  notifiedItems.add(filename);
}

function isItemNotified(filename) {
  return notifiedItems.has(filename);
}

function clearNotifiedItems() {
  notifiedItems.clear();
}

// ---- Gate reason (priority: hold > quiet_hours > pacing) --------------------

function researchGateReason() {
  if (isHoldActive())           return 'hold';
  if (isInQuietHours())         return 'quiet_hours';
  if (isWithinPacingInterval()) return 'pacing';
  return null;
}

module.exports = {
  researchGateReason,
  isHoldActive,
  setHold,
  recordResearchCompletion,
  markItemNotified,
  isItemNotified,
  clearNotifiedItems,
};
