'use strict';

// Interactive Discord auth flow using a proper bot token (discord.js WebSocket).
// This is separate from the existing DISCORD_WEBHOOK_URL one-way notifications.
//
// When enabled, auth failures post a message with buttons so the user can
// authorize Claude from Discord or approve API key fallback, without SSH-ing in.

const logger = require('./logger');

const INTERACTIVE_AUTH   = (process.env.DISCORD_INTERACTIVE_AUTH || '').toLowerCase() === 'true';
const BOT_TOKEN          = process.env.DISCORD_BOT_TOKEN  || '';
const CHANNEL_ID         = process.env.DISCORD_CHANNEL_ID || '';
const TIMEOUT_MINUTES        = parseInt(process.env.DISCORD_AUTH_TIMEOUT_MINUTES || '5', 10);
const TIMEOUT_MS             = TIMEOUT_MINUTES * 60 * 1000;
const RATE_LIMIT_TIMEOUT_MS  = 24 * 60 * 60 * 1000;

let client  = null;
let pendingDecision = null;  // { resolve, timeoutId, messageRef }
let expediteHandler = null;  // registered by index.js via setExpediteHandler

function isEnabled() {
  return INTERACTIVE_AUTH && !!client;
}

// Registers the callback invoked when the user clicks an Expedite button.
// Wired in index.js to avoid a circular dependency between discord-bot and inbox-watcher.
function setExpediteHandler(fn) {
  expediteHandler = fn;
}

// Call once at startup when DISCORD_INTERACTIVE_AUTH=true.
// Returns a promise that resolves once the bot is ready (or rejects on bad token).
async function init() {
  if (!INTERACTIVE_AUTH) return;
  if (!BOT_TOKEN)   throw new Error('DISCORD_INTERACTIVE_AUTH=true but DISCORD_BOT_TOKEN is not set');
  if (!CHANNEL_ID)  throw new Error('DISCORD_INTERACTIVE_AUTH=true but DISCORD_CHANNEL_ID is not set');

  // Lazy-require discord.js so non-interactive mode has zero overhead.
  const { Client, GatewayIntentBits } = require('discord.js');

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // ---- Per-item expedite (fire-and-forget, no pendingDecision involved) ----
    if (interaction.customId.startsWith('research_expedite:')) {
      const filename = interaction.customId.slice('research_expedite:'.length);
      await interaction.deferUpdate().catch(() => {});
      if (expediteHandler) {
        try {
          await expediteHandler(filename);
          const displayName = filename.replace(/\.md$/, '').replace(/-/g, ' ');
          await interaction.editReply({ content: `▶️ Expediting *${displayName}*…`, components: [] }).catch(() => {});
        } catch (err) {
          logger.warn(`discord-bot: expedite handler failed (${err.message})`);
          await interaction.editReply({ content: '⚠️ Expedite failed — check bot logs.', components: [] }).catch(() => {});
        }
      } else {
        await interaction.editReply({ content: '⚠️ Expedite handler not registered.', components: [] }).catch(() => {});
      }
      return;
    }

    // ---- Auth / rate-limit decisions (block until user acts) -----------------
    if (!pendingDecision) {
      await interaction.reply({ content: 'No pending auth decision.', ephemeral: true }).catch(() => {});
      return;
    }

    const { resolve, timeoutId, messageRef } = pendingDecision;
    pendingDecision = null;
    clearTimeout(timeoutId);

    const id = interaction.customId;
    let responseText;

    if (id === 'auth-done') {
      responseText = '✅ Got it — retrying with subscription…';
      await safeUpdate(interaction, responseText, []);
      resolve('retry-subscription');
    } else if (id === 'auth-api-key') {
      responseText = '💰 Using API key for this task.';
      await safeUpdate(interaction, responseText, []);
      resolve('use-api-key');
    } else if (id === 'rate-limit-wait') {
      responseText = '⏳ Holding until rate limit resets.';
      await safeUpdate(interaction, responseText, []);
      resolve('wait-for-reset');
    } else if (id === 'rate-limit-api-key') {
      responseText = '💰 Using API key for this task.';
      await safeUpdate(interaction, responseText, []);
      resolve('use-api-key');
    } else {
      // Unknown button — ignore
      await interaction.reply({ content: 'Unknown action.', ephemeral: true }).catch(() => {});
      // Put it back
      pendingDecision = { resolve, timeoutId, messageRef };
    }
  });

  // ---- Text commands (!research hold / release / status) -------------------
  // Requires "Message Content Intent" in the Discord developer portal.
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CHANNEL_ID) return;
    const text = message.content.trim().toLowerCase();
    if      (text === '!research hold')    await handleHoldCommand(message, true);
    else if (text === '!research release') await handleHoldCommand(message, false);
    else if (text === '!research status')  await handleStatusCommand(message);
  });

  // Wait for the `ready` event — login() only resolves when the auth request
  // is sent, not when the gateway handshake completes. Calling channel.send()
  // before ready causes silent failures.
  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.login(BOT_TOKEN).catch(reject);
  });

  logger.info('discord-bot: ready');
}

async function handleHoldCommand(message, activate) {
  const researchGate = require('./research-gate');
  try {
    if (activate && researchGate.isHoldActive()) {
      await message.reply('Research is already on hold.').catch(() => {});
      return;
    }
    if (!activate && !researchGate.isHoldActive()) {
      await message.reply('Research is not currently on hold.').catch(() => {});
      return;
    }
    await researchGate.setHold(activate);
    const reply = activate
      ? 'Research processing paused. Use `!research release` to resume.'
      : 'Research processing resumed.';
    await message.reply(reply).catch(() => {});
    logger.info(`discord-bot: research hold ${activate ? 'activated' : 'released'} via Discord`);
  } catch (err) {
    logger.warn(`discord-bot: hold command failed (${err.message})`);
    await message.reply('Failed to update hold state — check bot logs.').catch(() => {});
  }
}

async function handleStatusCommand(message) {
  const researchGate = require('./research-gate');
  const holdActive = researchGate.isHoldActive();
  const gateReason = researchGate.researchGateReason();
  const holdLine   = holdActive ? '🔴 Hold: **active**' : '🟢 Hold: inactive';
  const gateLine   = gateReason ? `Gate: \`${gateReason}\`` : 'Gate: clear';
  await message.reply(`${holdLine}\n${gateLine}`).catch(() => {});
}

// Posts an auth decision message to DISCORD_CHANNEL_ID and waits for the user
// to click a button or for the timeout to expire.
// Returns: 'retry-subscription' | 'use-api-key'
// Never rejects — errors fall back to 'use-api-key'.
async function askAuthDecision(label, oauthUrl, loginProc) {
  if (!client) return 'use-api-key';

  try {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const channel = await client.channels.fetch(CHANNEL_ID);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔐 Authorize Claude')
        .setStyle(ButtonStyle.Link)
        .setURL(oauthUrl),
      new ButtonBuilder()
        .setCustomId('auth-done')
        .setLabel('✅ Done — retry subscription')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('auth-api-key')
        .setLabel('💰 Use API Key')
        .setStyle(ButtonStyle.Danger),
    );

    const taskLine = label ? `\n**Task:** *${label}*` : '';
    const content = [
      `⚠️ **rockybot: Claude subscription auth expired**${taskLine}`,
      `Click **Authorize Claude** to re-auth, then **Done** when finished.`,
      `Or use the API key (charges apply). Auto-fallback in **${TIMEOUT_MINUTES} min**.`,
    ].join('\n');

    const msg = await channel.send({ content, components: [row] });

    return await new Promise((resolve) => {
      const timeoutId = setTimeout(async () => {
        if (!pendingDecision) return;
        pendingDecision = null;
        safeKill(loginProc);
        await msg.edit({ content: `⏱️ Auth timed out after ${TIMEOUT_MINUTES} min — falling back to API key.`, components: [] }).catch(() => {});
        resolve('use-api-key');
      }, TIMEOUT_MS);

      pendingDecision = { resolve: (decision) => { safeKill(loginProc); resolve(decision); }, timeoutId, messageRef: msg };
    });

  } catch (err) {
    logger.warn(`discord-bot: askAuthDecision failed (${err.message}) — falling back to API key`);
    safeKill(loginProc);
    return 'use-api-key';
  }
}

function safeKill(proc) {
  try { if (proc && !proc.killed) proc.kill(); } catch (_) {}
}

async function safeUpdate(interaction, content, components) {
  try {
    await interaction.update({ content, components });
  } catch (_) {
    await interaction.reply({ content, ephemeral: true }).catch(() => {});
  }
}

// Posts a rate-limit decision message to Discord and waits for the user to choose
// "Wait for reset" or "Use API Key".  Times out after 24h (falls back to API key).
// Returns: 'wait-for-reset' | 'use-api-key'
// Never rejects — errors fall back to 'use-api-key'.
async function askRateLimitDecision(label, resetTime) {
  if (!client) return 'use-api-key';

  try {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const channel = await client.channels.fetch(CHANNEL_ID);

    const resetStr = resetTime
      ? `Resets at **${resetTime.toUTCString()}**.`
      : 'Reset time unknown — will retry every 30 minutes.';
    const taskLine = label ? `\n**Task:** *${label}*` : '';
    const content = [
      `⏳ **rockybot: Claude usage limit reached**${taskLine}`,
      resetStr,
      `Bot will hold until reset. Click to override with API key (charges apply).`,
    ].join('\n');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('rate-limit-wait')
        .setLabel('⏳ Wait for reset')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('rate-limit-api-key')
        .setLabel('💰 Use API Key')
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await channel.send({ content, components: [row] });

    return await new Promise((resolve) => {
      const timeoutId = setTimeout(async () => {
        if (!pendingDecision) return;
        pendingDecision = null;
        await msg.edit({ content: `⏱️ No response after 24h — falling back to API key.`, components: [] }).catch(() => {});
        resolve('use-api-key');
      }, RATE_LIMIT_TIMEOUT_MS);

      pendingDecision = { resolve, timeoutId, messageRef: msg };
    });

  } catch (err) {
    logger.warn(`discord-bot: askRateLimitDecision failed (${err.message}) — falling back to API key`);
    return 'use-api-key';
  }
}

// Sends a fire-and-forget notification for a new inbox item queued during quiet hours.
// Includes an Expedite button so the user can promote the item immediately.
// Never rejects.
async function notifyQuietHoursItem(filename) {
  if (!client) return;
  try {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const channel     = await client.channels.fetch(CHANNEL_ID);
    const displayName = filename.replace(/\.md$/, '').replace(/-/g, ' ');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`research_expedite:${filename}`)
        .setLabel('▶️ Run now')
        .setStyle(ButtonStyle.Primary),
    );

    await channel.send({
      content: `📥 **Research queued** (quiet hours active): *${displayName}*\nClick to run immediately.`,
      components: [row],
    });
  } catch (err) {
    logger.warn(`discord-bot: notifyQuietHoursItem failed (${err.message})`);
  }
}

// Posts a plain startup message to the bot channel. Never throws.
async function broadcastStartup(version) {
  if (!client) return;
  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    await ch.send(`🤖 **rockybot v${version}** started — online and polling.`);
  } catch (err) {
    logger.warn(`discord-bot: broadcastStartup failed (${err.message})`);
  }
}

module.exports = { init, isEnabled, setExpediteHandler, askAuthDecision, askRateLimitDecision, notifyQuietHoursItem, broadcastStartup };
