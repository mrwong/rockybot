'use strict';

// Tests for research-gate.js — quiet hours parsing, pacing, hold file, and gate priority.
// Hold file tests use a real temp directory (consistent with seeder.test.js approach).
// Quiet-hours and pacing tests use freshRequires() + env vars to test parsed-at-load logic.

const path = require('path');
const os   = require('os');
const fs   = require('fs-extra');

jest.mock('../../services/bot/src/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

function freshRequires(env = {}) {
  ['RESEARCH_QUIET_HOURS', 'RESEARCH_MIN_INTERVAL_MINUTES', 'VAULT_PATH'].forEach(k => delete process.env[k]);
  Object.assign(process.env, env);
  jest.resetModules();
  return {
    gate:   require('../../services/bot/src/research-gate'),
    logger: require('../../services/bot/src/logger'),
  };
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  ['RESEARCH_QUIET_HOURS', 'RESEARCH_MIN_INTERVAL_MINUTES', 'VAULT_PATH'].forEach(k => delete process.env[k]);
});

// ---------------------------------------------------------------------------
// Quiet hours — normal window
// ---------------------------------------------------------------------------

describe('isInQuietHours: normal window (09:00-18:00)', () => {
  function makeGate(nowUtcHour, nowUtcMin = 0) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, nowUtcHour, nowUtcMin, 0)));
    return freshRequires({ RESEARCH_QUIET_HOURS: '09:00-18:00' }).gate;
  }

  it('suppresses at 10:00 UTC (inside window)', () => {
    expect(makeGate(10).researchGateReason()).toBe('quiet_hours');
  });

  it('suppresses at 09:00 UTC (exactly at start)', () => {
    expect(makeGate(9, 0).researchGateReason()).toBe('quiet_hours');
  });

  it('does not suppress at 18:00 UTC (exactly at end — exclusive)', () => {
    expect(makeGate(18, 0).researchGateReason()).toBeNull();
  });

  it('does not suppress at 08:59 UTC (before window)', () => {
    expect(makeGate(8, 59).researchGateReason()).toBeNull();
  });

  it('does not suppress at 20:00 UTC (after window)', () => {
    expect(makeGate(20).researchGateReason()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quiet hours — midnight-spanning window
// ---------------------------------------------------------------------------

describe('isInQuietHours: midnight-spanning window (22:00-06:00)', () => {
  function makeGate(nowUtcHour, nowUtcMin = 0) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, nowUtcHour, nowUtcMin, 0)));
    return freshRequires({ RESEARCH_QUIET_HOURS: '22:00-06:00' }).gate;
  }

  it('suppresses at 23:00 UTC (after start, before midnight)', () => {
    expect(makeGate(23).researchGateReason()).toBe('quiet_hours');
  });

  it('suppresses at 03:00 UTC (after midnight, before end)', () => {
    expect(makeGate(3).researchGateReason()).toBe('quiet_hours');
  });

  it('suppresses at 22:00 UTC (exactly at start)', () => {
    expect(makeGate(22, 0).researchGateReason()).toBe('quiet_hours');
  });

  it('does not suppress at 06:00 UTC (exactly at end — exclusive)', () => {
    expect(makeGate(6, 0).researchGateReason()).toBeNull();
  });

  it('does not suppress at 12:00 UTC (middle of day, outside window)', () => {
    expect(makeGate(12).researchGateReason()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quiet hours — edge cases
// ---------------------------------------------------------------------------

describe('isInQuietHours: edge cases', () => {
  it('disabled when RESEARCH_QUIET_HOURS is blank', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0)));
    const { gate } = freshRequires({ RESEARCH_QUIET_HOURS: '' });
    expect(gate.researchGateReason()).toBeNull();
  });

  it('disabled when RESEARCH_QUIET_HOURS is not set', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0)));
    const { gate } = freshRequires({});
    expect(gate.researchGateReason()).toBeNull();
  });

  it('disabled and warns when RESEARCH_QUIET_HOURS is unparseable', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0)));
    const { gate, logger } = freshRequires({ RESEARCH_QUIET_HOURS: 'not-valid' });
    expect(gate.researchGateReason()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not valid'));
  });

  it('disabled when start equals end (09:00-09:00)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 9, 0, 0)));
    const { gate } = freshRequires({ RESEARCH_QUIET_HOURS: '09:00-09:00' });
    expect(gate.researchGateReason()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

describe('isWithinPacingInterval', () => {
  it('never gates when RESEARCH_MIN_INTERVAL_MINUTES=0 (default)', () => {
    jest.useFakeTimers();
    const { gate } = freshRequires({ RESEARCH_MIN_INTERVAL_MINUTES: '0' });
    gate.recordResearchCompletion();
    expect(gate.researchGateReason()).toBeNull();
  });

  it('never gates before first recordResearchCompletion (initial state)', () => {
    const { gate } = freshRequires({ RESEARCH_MIN_INTERVAL_MINUTES: '60' });
    expect(gate.researchGateReason()).toBeNull();
  });

  it('gates immediately after completion within the interval', () => {
    jest.useFakeTimers();
    const { gate } = freshRequires({ RESEARCH_MIN_INTERVAL_MINUTES: '60' });
    gate.recordResearchCompletion();
    jest.advanceTimersByTime(30 * 60 * 1000); // 30 min elapsed
    expect(gate.researchGateReason()).toBe('pacing');
  });

  it('clears after the interval elapses', () => {
    jest.useFakeTimers();
    const { gate } = freshRequires({ RESEARCH_MIN_INTERVAL_MINUTES: '60' });
    gate.recordResearchCompletion();
    jest.advanceTimersByTime(61 * 60 * 1000); // 61 min elapsed
    expect(gate.researchGateReason()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hold file (real temp filesystem)
// ---------------------------------------------------------------------------

describe('isHoldActive / setHold', () => {
  let tmpVault;
  let gate;

  beforeEach(async () => {
    tmpVault = await fs.mkdtemp(path.join(os.tmpdir(), 'research-gate-'));
    const { gate: g } = freshRequires({ VAULT_PATH: tmpVault });
    gate = g;
  });

  afterEach(async () => {
    await fs.remove(tmpVault);
  });

  it('returns false when hold file does not exist', () => {
    expect(gate.isHoldActive()).toBe(false);
  });

  it('returns true when hold file exists', async () => {
    const holdFile = path.join(tmpVault, 'research', '.research-hold');
    await fs.outputFile(holdFile, '');
    expect(gate.isHoldActive()).toBe(true);
  });

  it('setHold(true) creates the hold file', async () => {
    await gate.setHold(true);
    const holdFile = path.join(tmpVault, 'research', '.research-hold');
    expect(await fs.pathExists(holdFile)).toBe(true);
  });

  it('setHold(false) removes the hold file', async () => {
    const holdFile = path.join(tmpVault, 'research', '.research-hold');
    await fs.outputFile(holdFile, '');
    await gate.setHold(false);
    expect(await fs.pathExists(holdFile)).toBe(false);
  });

  it('setHold(false) is a no-op when hold file does not exist', async () => {
    await expect(gate.setHold(false)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Priority ordering (real temp filesystem for hold state)
// ---------------------------------------------------------------------------

describe('researchGateReason: priority ordering', () => {
  let tmpVault;

  beforeEach(async () => {
    tmpVault = await fs.mkdtemp(path.join(os.tmpdir(), 'research-gate-'));
  });

  afterEach(async () => {
    await fs.remove(tmpVault);
  });

  it('returns "hold" when hold, quiet hours, and pacing are all active', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0)));
    const { gate } = freshRequires({
      RESEARCH_QUIET_HOURS: '09:00-18:00',
      RESEARCH_MIN_INTERVAL_MINUTES: '60',
      VAULT_PATH: tmpVault,
    });
    await fs.outputFile(path.join(tmpVault, 'research', '.research-hold'), '');
    gate.recordResearchCompletion();
    expect(gate.researchGateReason()).toBe('hold');
  });

  it('returns "quiet_hours" when hold is inactive but in quiet window', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0)));
    const { gate } = freshRequires({
      RESEARCH_QUIET_HOURS: '09:00-18:00',
      RESEARCH_MIN_INTERVAL_MINUTES: '60',
      VAULT_PATH: tmpVault,
    });
    gate.recordResearchCompletion();
    expect(gate.researchGateReason()).toBe('quiet_hours');
  });

  it('returns "pacing" when only pacing is active', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0)));
    const { gate } = freshRequires({
      RESEARCH_MIN_INTERVAL_MINUTES: '60',
      VAULT_PATH: tmpVault,
    });
    gate.recordResearchCompletion();
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(gate.researchGateReason()).toBe('pacing');
  });

  it('returns null when nothing is active', () => {
    const { gate } = freshRequires({ VAULT_PATH: tmpVault });
    expect(gate.researchGateReason()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Notified items tracking
// ---------------------------------------------------------------------------

describe('notified items', () => {
  it('markItemNotified / isItemNotified round-trip', () => {
    const { gate } = freshRequires();
    gate.markItemNotified('topic-a.md');
    expect(gate.isItemNotified('topic-a.md')).toBe(true);
    expect(gate.isItemNotified('topic-b.md')).toBe(false);
  });

  it('clearNotifiedItems removes all entries', () => {
    const { gate } = freshRequires();
    gate.markItemNotified('topic-a.md');
    gate.markItemNotified('topic-b.md');
    gate.clearNotifiedItems();
    expect(gate.isItemNotified('topic-a.md')).toBe(false);
    expect(gate.isItemNotified('topic-b.md')).toBe(false);
  });
});
