'use strict';

// Tests for claude-runner.js billing fallback logic.
// All tests mock child_process.spawn so no real Claude is invoked.

const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../services/bot/src/notifier', () => ({
  notifyAuthExpired: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/bot/src/discord-bot', () => ({
  isEnabled:       jest.fn().mockReturnValue(false),
  init:            jest.fn().mockResolvedValue(undefined),
  askAuthDecision: jest.fn().mockResolvedValue('use-api-key'),
}));
jest.mock('../../services/bot/src/login-runner', () => ({
  startLogin: jest.fn().mockResolvedValue({ url: 'https://auth.example.com/oauth', proc: { kill: jest.fn(), killed: false } }),
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
    discordBot:        require('../../services/bot/src/discord-bot'),
    startLogin:        require('../../services/bot/src/login-runner').startLogin,
    logger:            require('../../services/bot/src/logger'),
  };
}

afterEach(() => {
  delete process.env.CLAUDE_SUBSCRIPTION_MODE;
  delete process.env.DISCORD_INTERACTIVE_AUTH;
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

// ---------------------------------------------------------------------------
// Interactive auth mode (DISCORD_INTERACTIVE_AUTH=true)
// ---------------------------------------------------------------------------

describe('interactive auth mode: user chooses API key', () => {
  it('calls startLogin and askAuthDecision on auth failure', async () => {
    const { runClaude, spawn, discordBot, startLogin } = freshRequires({
      CLAUDE_SUBSCRIPTION_MODE: 'true',
      DISCORD_INTERACTIVE_AUTH: 'true',
    });
    discordBot.isEnabled.mockReturnValue(true);
    discordBot.askAuthDecision.mockResolvedValue('use-api-key');
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'not authenticated' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await expect(runClaude('prompt', '/tmp', { label: 'test-task.md' })).resolves.toBeUndefined();
    expect(startLogin).toHaveBeenCalledTimes(1);
    expect(discordBot.askAuthDecision).toHaveBeenCalledWith('test-task.md', 'https://auth.example.com/oauth', expect.anything());
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('does NOT call notifyAuthExpired in interactive mode', async () => {
    const { runClaude, spawn, discordBot, notifyAuthExpired } = freshRequires({
      CLAUDE_SUBSCRIPTION_MODE: 'true',
      DISCORD_INTERACTIVE_AUTH: 'true',
    });
    discordBot.isEnabled.mockReturnValue(true);
    discordBot.askAuthDecision.mockResolvedValue('use-api-key');
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'not authenticated' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await runClaude('prompt', '/tmp', {});
    expect(notifyAuthExpired).not.toHaveBeenCalled();
  });
});

describe('interactive auth mode: user chooses retry-subscription', () => {
  it('retries with subscription billing after re-auth', async () => {
    const { runClaude, spawn, discordBot } = freshRequires({
      CLAUDE_SUBSCRIPTION_MODE: 'true',
      DISCORD_INTERACTIVE_AUTH: 'true',
    });
    discordBot.isEnabled.mockReturnValue(true);
    discordBot.askAuthDecision.mockResolvedValue('retry-subscription');
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'not authenticated' }))  // initial attempt
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'subscription output' })); // retry succeeds

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(2);
    // Second spawn must NOT pass ANTHROPIC_API_KEY (subscription billing)
    const secondCallEnv = spawn.mock.calls[1][2].env;
    expect(secondCallEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('throws when subscription retry also fails', async () => {
    const { runClaude, spawn, discordBot } = freshRequires({
      CLAUDE_SUBSCRIPTION_MODE: 'true',
      DISCORD_INTERACTIVE_AUTH: 'true',
    });
    discordBot.isEnabled.mockReturnValue(true);
    discordBot.askAuthDecision.mockResolvedValue('retry-subscription');
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'not authenticated' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'still not authenticated' }));

    await expect(runClaude('prompt', '/tmp', {})).rejects.toThrow('claude (subscription retry) failed');
  });
});

describe('interactive auth mode: silent exit', () => {
  it('also enters interactive flow on silent exit', async () => {
    const { runClaude, spawn, discordBot, startLogin } = freshRequires({
      CLAUDE_SUBSCRIPTION_MODE: 'true',
      DISCORD_INTERACTIVE_AUTH: 'true',
    });
    discordBot.isEnabled.mockReturnValue(true);
    discordBot.askAuthDecision.mockResolvedValue('use-api-key');
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: '', stderr: '' }))  // silent exit
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await expect(runClaude('prompt', '/tmp', {})).resolves.toBeUndefined();
    expect(startLogin).toHaveBeenCalledTimes(1);
  });
});

describe('basic mode still works when interactive auth is off', () => {
  it('calls notifyAuthExpired and does NOT call startLogin', async () => {
    const { runClaude, spawn, notifyAuthExpired, startLogin } = freshRequires({
      CLAUDE_SUBSCRIPTION_MODE: 'true',
      DISCORD_INTERACTIVE_AUTH: 'false',
    });
    spawn
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: 'not authenticated' }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: 'api output' }));

    await runClaude('prompt', '/tmp', {});
    expect(notifyAuthExpired).toHaveBeenCalledTimes(1);
    expect(startLogin).not.toHaveBeenCalled();
  });
});
