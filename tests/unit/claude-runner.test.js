'use strict';

// Tests for claude-runner.js billing fallback logic.
// All tests mock child_process.spawn so no real Claude is invoked.

const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../services/bot/src/notifier', () => ({
  notifyAuthExpired: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/bot/src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Build a fake child process that emits stdout/stderr/close on the next tick.
function fakeProc({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  });
  return proc;
}

// After jest.resetModules() we must re-require every mocked module to get
// fresh references — resetModules clears the registry but keeps mock factories.
function freshRequires(env = {}) {
  Object.assign(process.env, env);
  jest.resetModules();
  return {
    runClaude:         require('../../services/bot/src/claude-runner').runClaude,
    spawn:             require('child_process').spawn,
    notifyAuthExpired: require('../../services/bot/src/notifier').notifyAuthExpired,
    logger:            require('../../services/bot/src/logger'),
  };
}

afterEach(() => {
  delete process.env.CLAUDE_SUBSCRIPTION_MODE;
  delete process.env.DRY_RUN;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Subscription mode
// ---------------------------------------------------------------------------

describe('subscription mode: happy path', () => {
  it('returns after one spawn when subscription succeeds (exit 0 + stdout)', async () => {
    const { runClaude, spawn } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn.mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'research output' }));

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('subscription mode: silent exit (the homelab bug)', () => {
  // Claude exits 0 with no stdout and no stderr when the session is expired or
  // .claude.json is missing. This was causing the bot to silently skip research
  // requests indefinitely — the fix treats empty stdout as auth failure.

  it('falls back to API key when subscription exits silently', async () => {
    const { runClaude, spawn } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: '', stderr: '' }))  // silent exit
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));   // API key succeeds

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('fires Discord auth alert on silent exit', async () => {
    const { runClaude, spawn, notifyAuthExpired } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: '', stderr: '' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await runClaude('prompt', '/tmp', {});
    expect(notifyAuthExpired).toHaveBeenCalledTimes(1);
  });

  it('logs a warning mentioning "silently" and "claude login" on silent exit', async () => {
    const { runClaude, spawn, logger } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: '', stderr: '' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await runClaude('prompt', '/tmp', {});
    const warnCall = logger.warn.mock.calls.find(c => c[0].includes('silently'));
    expect(warnCall).toBeDefined();
    expect(warnCall[0]).toMatch(/claude login/);
  });

  it('throws when API key fallback also exits silently', async () => {
    const { runClaude, spawn } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: '', stderr: '' }))  // subscription silent
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: '', stderr: '' })); // API key silent

    await expect(runClaude('prompt', '/tmp', {})).rejects.toThrow('claude (api fallback) failed');
  });
});

describe('subscription mode: auth error in stderr', () => {
  const authMessages = [
    'Claude configuration file not found at: /home/ubuntu/.claude.json',
    'not authenticated',
    'unauthorized',
    'login required',
  ];

  for (const msg of authMessages) {
    it(`falls back to API key for stderr: "${msg}"`, async () => {
      const { runClaude, spawn, notifyAuthExpired } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
      spawn
        .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: msg }))
        .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

      await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(notifyAuthExpired).toHaveBeenCalled();
    });
  }
});

describe('subscription mode: rate limit', () => {
  it('falls back to API key without firing Discord alert', async () => {
    const { runClaude, spawn, notifyAuthExpired } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'rate limit exceeded' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(notifyAuthExpired).not.toHaveBeenCalled();
  });
});

describe('subscription mode: unrecognized error', () => {
  it('throws without falling back when stderr has an unknown error', async () => {
    const { runClaude, spawn } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'true' });
    spawn.mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'some unexpected internal error' }));

    await expect(runClaude('prompt', '/tmp', {})).rejects.toThrow('claude (subscription) failed');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// API key mode (no subscription)
// ---------------------------------------------------------------------------

describe('API key mode', () => {
  it('calls claude once and returns on success', async () => {
    const { runClaude, spawn } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'false' });
    spawn.mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'research output' }));

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('throws when API key billing fails', async () => {
    const { runClaude, spawn } = freshRequires({ CLAUDE_SUBSCRIPTION_MODE: 'false' });
    spawn.mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'invalid api key' }));

    await expect(runClaude('prompt', '/tmp', {})).rejects.toThrow('claude failed');
  });
});

// ---------------------------------------------------------------------------
// DRY_RUN mode
// ---------------------------------------------------------------------------

describe('DRY_RUN mode', () => {
  it('does not spawn claude', async () => {
    const { runClaude, spawn } = freshRequires({ DRY_RUN: 'true' });

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('logs what would be called', async () => {
    const { runClaude, logger } = freshRequires({ DRY_RUN: 'true' });

    await runClaude('prompt', '/tmp', { model: 'haiku', budgetUsd: '0.50' });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('DRY_RUN'));
  });
});
