'use strict';

// Tests for discord-bot.js.
// Covers: init() guard checks, broadcastStartup()/notifyQuietHoursItem()
// fault tolerance (must never throw regardless of Discord API errors), and
// the !research text commands routed through the messageCreate handler.
//
// discord.js is mocked with an EventEmitter-based MockClient so the ready
// event lifecycle can be exercised without real network calls.

const { EventEmitter } = require('events');

// Captured by MockClient constructor on each init() call.
// Reset to null at the start of each freshRequires() call.
let mockClient = null;

// jest.mock() factories may only reference variables prefixed with "mock".
// Control login() behavior through this object instead of a plain boolean.
const mockConfig = { loginShouldFail: false };

jest.mock('discord.js', () => {
  const { EventEmitter } = require('events');

  class MockClient extends EventEmitter {
    constructor() {
      super();
      this.channels = {
        fetch: jest.fn().mockResolvedValue({ send: jest.fn().mockResolvedValue({}) }),
      };
      // Fires the ready event after resolving so the once('ready') handler runs.
      this.login = jest.fn().mockImplementation(() => {
        if (mockConfig.loginShouldFail) return Promise.reject(new Error('Invalid token'));
        setImmediate(() => this.emit('ready'));
        return Promise.resolve('token');
      });
      mockClient = this;
    }
  }

  return {
    Client: MockClient,
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 },
    ActionRowBuilder: jest.fn().mockImplementation(() => ({
      addComponents: jest.fn().mockReturnThis(),
    })),
    ButtonBuilder: jest.fn().mockImplementation(() => ({
      setCustomId: jest.fn().mockReturnThis(),
      setLabel:    jest.fn().mockReturnThis(),
      setStyle:    jest.fn().mockReturnThis(),
      setURL:      jest.fn().mockReturnThis(),
    })),
    ButtonStyle: { Primary: 1, Success: 2, Danger: 3, Link: 4 },
  };
}, { virtual: true });

jest.mock('../../services/bot/src/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../services/bot/src/research-gate', () => ({
  isHoldActive:       jest.fn().mockReturnValue(false),
  setHold:            jest.fn().mockResolvedValue(undefined),
  researchGateReason: jest.fn().mockReturnValue(null),
}));

const ENV_VALID = {
  DISCORD_INTERACTIVE_AUTH: 'true',
  DISCORD_BOT_TOKEN:        'fake-token',
  DISCORD_CHANNEL_ID:       '987654321',
};

function freshRequires(env = {}) {
  ['DISCORD_INTERACTIVE_AUTH', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID',
    'DISCORD_AUTH_TIMEOUT_MINUTES'].forEach(k => delete process.env[k]);
  Object.assign(process.env, env);
  jest.resetModules();
  mockClient = null;
  mockConfig.loginShouldFail = false;
  return {
    bot:    require('../../services/bot/src/discord-bot'),
    logger: require('../../services/bot/src/logger'),
    gate:   require('../../services/bot/src/research-gate'),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  mockConfig.loginShouldFail = false;
  ['DISCORD_INTERACTIVE_AUTH', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID',
    'DISCORD_AUTH_TIMEOUT_MINUTES'].forEach(k => delete process.env[k]);
});

// ---------------------------------------------------------------------------
// init() guards
// ---------------------------------------------------------------------------

describe('init(): mode and token guards', () => {
  it('is a no-op when DISCORD_INTERACTIVE_AUTH is not set', async () => {
    const { bot } = freshRequires({});
    await bot.init();
    expect(bot.isEnabled()).toBe(false);
    expect(mockClient).toBeNull();
  });

  it('is a no-op when DISCORD_INTERACTIVE_AUTH=false', async () => {
    const { bot } = freshRequires({ DISCORD_INTERACTIVE_AUTH: 'false' });
    await bot.init();
    expect(bot.isEnabled()).toBe(false);
    expect(mockClient).toBeNull();
  });

  it('throws when DISCORD_BOT_TOKEN is missing', async () => {
    const { bot } = freshRequires({ DISCORD_INTERACTIVE_AUTH: 'true', DISCORD_CHANNEL_ID: '123' });
    await expect(bot.init()).rejects.toThrow('DISCORD_BOT_TOKEN');
  });

  it('throws when DISCORD_CHANNEL_ID is missing', async () => {
    const { bot } = freshRequires({ DISCORD_INTERACTIVE_AUTH: 'true', DISCORD_BOT_TOKEN: 'tok' });
    await expect(bot.init()).rejects.toThrow('DISCORD_CHANNEL_ID');
  });

  it('resolves and isEnabled() returns true with valid config', async () => {
    const { bot } = freshRequires(ENV_VALID);
    await bot.init();
    expect(bot.isEnabled()).toBe(true);
  });

  it('propagates login() rejection so a bad token fails loudly', async () => {
    const { bot } = freshRequires(ENV_VALID);
    mockConfig.loginShouldFail = true;
    await expect(bot.init()).rejects.toThrow('Invalid token');
  });
});

// ---------------------------------------------------------------------------
// broadcastStartup() — the crashloop regression
// ---------------------------------------------------------------------------

describe('broadcastStartup(): fault tolerance', () => {
  it('is a no-op when interactive mode is disabled (no client)', async () => {
    const { bot } = freshRequires({});
    await expect(bot.broadcastStartup('1.2.0')).resolves.toBeUndefined();
  });

  it('does not throw when channel.fetch rejects', async () => {
    const { bot } = freshRequires(ENV_VALID);
    await bot.init();
    mockClient.channels.fetch.mockRejectedValueOnce(new Error('Unknown Channel'));
    await expect(bot.broadcastStartup('1.2.0')).resolves.toBeUndefined();
  });

  it('logs a warning when channel.fetch rejects', async () => {
    const { bot, logger } = freshRequires(ENV_VALID);
    await bot.init();
    mockClient.channels.fetch.mockRejectedValueOnce(new Error('Unknown Channel'));
    await bot.broadcastStartup('1.2.0');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('broadcastStartup failed'));
  });

  it('does not throw when channel.send rejects', async () => {
    const { bot } = freshRequires(ENV_VALID);
    await bot.init();
    mockClient.channels.fetch.mockResolvedValueOnce({
      send: jest.fn().mockRejectedValueOnce(new Error('Missing Permissions')),
    });
    await expect(bot.broadcastStartup('1.2.0')).resolves.toBeUndefined();
  });

  it('sends a message containing the version string', async () => {
    const { bot } = freshRequires(ENV_VALID);
    await bot.init();
    const mockSend = jest.fn().mockResolvedValue({});
    mockClient.channels.fetch.mockResolvedValueOnce({ send: mockSend });
    await bot.broadcastStartup('1.2.0');
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('v1.2.0'));
  });
});

// ---------------------------------------------------------------------------
// notifyQuietHoursItem() — fault tolerance
// ---------------------------------------------------------------------------

describe('notifyQuietHoursItem(): fault tolerance', () => {
  it('is a no-op when interactive mode is disabled (no client)', async () => {
    const { bot } = freshRequires({});
    await expect(bot.notifyQuietHoursItem('topic.md')).resolves.toBeUndefined();
  });

  it('does not throw when channel.fetch rejects', async () => {
    const { bot } = freshRequires(ENV_VALID);
    await bot.init();
    mockClient.channels.fetch.mockRejectedValueOnce(new Error('Unknown Channel'));
    await expect(bot.notifyQuietHoursItem('topic.md')).resolves.toBeUndefined();
  });

  it('logs a warning when channel.fetch rejects', async () => {
    const { bot, logger } = freshRequires(ENV_VALID);
    await bot.init();
    mockClient.channels.fetch.mockRejectedValueOnce(new Error('Unknown Channel'));
    await bot.notifyQuietHoursItem('topic.md');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('notifyQuietHoursItem failed'));
  });
});

// ---------------------------------------------------------------------------
// !research text commands (messageCreate handler)
// ---------------------------------------------------------------------------

describe('!research text commands', () => {
  function makeMessage(content, channelId = ENV_VALID.DISCORD_CHANNEL_ID) {
    return {
      author:    { bot: false },
      channelId,
      content,
      reply:     jest.fn().mockResolvedValue({}),
    };
  }

  // Yield to let the async messageCreate handler fully drain its awaits.
  const flush = () => new Promise(resolve => setImmediate(resolve));

  it('!research hold calls setHold(true) and replies with confirmation', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();
    gate.isHoldActive.mockReturnValue(false);

    const msg = makeMessage('!research hold');
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(gate.setHold).toHaveBeenCalledWith(true);
    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('paused'));
  });

  it('!research hold is idempotent when already held', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();
    gate.isHoldActive.mockReturnValue(true);

    const msg = makeMessage('!research hold');
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(gate.setHold).not.toHaveBeenCalled();
    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('already'));
  });

  it('!research release calls setHold(false) and replies with confirmation', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();
    gate.isHoldActive.mockReturnValue(true);

    const msg = makeMessage('!research release');
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(gate.setHold).toHaveBeenCalledWith(false);
    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('resumed'));
  });

  it('!research release is idempotent when not currently held', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();
    gate.isHoldActive.mockReturnValue(false);

    const msg = makeMessage('!research release');
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(gate.setHold).not.toHaveBeenCalled();
    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('not currently'));
  });

  it('!research status reports inactive hold and clear gate', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();
    gate.isHoldActive.mockReturnValue(false);
    gate.researchGateReason.mockReturnValue(null);

    const msg = makeMessage('!research status');
    mockClient.emit('messageCreate', msg);
    await flush();

    const reply = msg.reply.mock.calls[0][0];
    expect(reply).toMatch(/inactive/i);
    expect(reply).toMatch(/clear/i);
  });

  it('!research status reports active hold', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();
    gate.isHoldActive.mockReturnValue(true);
    gate.researchGateReason.mockReturnValue('hold');

    const msg = makeMessage('!research status');
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('active'));
  });

  it('ignores messages from other channels', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();

    const msg = makeMessage('!research hold', 'other-channel-id');
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(gate.setHold).not.toHaveBeenCalled();
  });

  it('ignores messages from bots', async () => {
    const { bot, gate } = freshRequires(ENV_VALID);
    await bot.init();

    const msg = { ...makeMessage('!research hold'), author: { bot: true } };
    mockClient.emit('messageCreate', msg);
    await flush();

    expect(gate.setHold).not.toHaveBeenCalled();
  });
});
