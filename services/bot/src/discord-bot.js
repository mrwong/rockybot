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
const TIMEOUT_MINUTES    = parseInt(process.env.DISCORD_AUTH_TIMEOUT_MINUTES || '5', 10);
const TIMEOUT_MS         = TIMEOUT_MINUTES * 60 * 1000;

let client = null;
let pendingDecision = null;  // { resolve, timeoutId, messageRef }

function isEnabled() {
  return INTERACTIVE_AUTH && !!client;
}

// Call once at startup when DISCORD_INTERACTIVE_AUTH=true.
// Returns a promise that resolves once the bot is ready (or rejects on bad token).
async function init() {
  if (!INTERACTIVE_AUTH) return;
  if (!BOT_TOKEN)   throw new Error('DISCORD_INTERACTIVE_AUTH=true but DISCORD_BOT_TOKEN is not set');
  if (!CHANNEL_ID)  throw new Error('DISCORD_INTERACTIVE_AUTH=true but DISCORD_CHANNEL_ID is not set');

  // Lazy-require discord.js so non-interactive mode has zero overhead.
  const { Client, GatewayIntentBits } = require('discord.js');

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
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
    } else {
      // Unknown button — ignore
      await interaction.reply({ content: 'Unknown action.', ephemeral: true }).catch(() => {});
      // Put it back
      pendingDecision = { resolve, timeoutId, messageRef };
    }
  });

  await client.login(BOT_TOKEN);
  logger.info('discord-bot: ready');
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

module.exports = { init, isEnabled, askAuthDecision };
