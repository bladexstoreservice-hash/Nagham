import 'dotenv/config';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  Message,
} from 'discord.js';
import {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  VOICE_CHANNEL_ID,
  PANEL_UPDATE_INTERVAL,
  WELCOME_DELETE_AFTER,
  WELCOME_UPDATE_INTERVAL,
  Track,
} from './config.js';
import { scanTracks, formatTotalTime } from './utils.js';
import {
  joinVoice,
  setOnTrackChange,
  setOnTrackEnd,
  updateTracks,
  getCurrentTrack,
} from './musicPlayer.js';
import { startStatusTimer } from './status.js';
import { loadEmojis, validateEmojis } from './emojiStore.js';
import {
  getCommands,
  handleMusicCommand,
  handleInfoCommand,
  handleTrackSelect,
  handleReloadCommand,
  handleSkipCommand,
  handlePauseCommand,
  handleStopCommand,
  handlePlayCommand,
  handleVolumeCommand,
  handleAutocomplete,
  handleSetEmojiCommand,
  handleListEmojisCommand,
  handleClearEmojisCommand,
  handleSleepButton,
  clearSleepTimer,
  setOnPanelUpdate,
  sessions,
  recordJoin,
  recordLeave,
  getTotalTimeMs,
} from './commands.js';
import {
  ATTACHMENT_NAME,
  buildPanelContainer,
  tryBuildAttachment,
} from './panel.js';
import { startWebServer, stopWebServer } from './server.js';

// ─── FFmpeg ──────────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string | null;

if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
  const ffmpegDir = path.dirname(ffmpegPath);
  process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ''}`;
  console.log(`[FFMPEG] Using: ${ffmpegPath}`);
}

// ─── Web Server (for Render / UptimeRobot) ───────────────────────────
startWebServer();

// ─── Globals ─────────────────────────────────────────────────────────
let allTracks: Track[] = [];
let stickyPanel: Message | null = null;
let attachedImagePath: string | null = null;
let lastImageCdnUrl: string | null = null;
let recreating = false;
let refreshing = false;

const welcomeMessages = new Map<string, Message>();

// ─── Client ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// ─── Debug Listeners (detect rate limits / silent failures) ─────────
client.on('debug', (info) => {
  // Filter out noisy WS heartbeats to reduce log spam
  if (info.includes('Heartbeat')) return;
  if (info.includes('ws')) return;
  console.log(`[DEBUG] ${info}`);
});

client.on('warn', (info) => {
  console.warn(`[WARN] ${info}`);
});

client.on('rateLimited', (info) => {
  console.warn('═══════════════════════════════════════════');
  console.warn('⚠️  RATE LIMITED BY DISCORD');
  console.warn('═══════════════════════════════════════════');
  console.warn(`Timeout:  ${info.timeToReset}ms`);
  console.warn(`Limit:    ${info.limit}`);
  console.warn(`Method:   ${info.method}`);
  console.warn(`Path:     ${info.path}`);
  console.warn(`Route:    ${info.route}`);
  console.warn(`Global:   ${info.global}`);
  console.warn('═══════════════════════════════════════════');
});

// ─── Preserved Attachments ───────────────────────────────────────────
function preservedAttachments(): Array<{ id: string; filename: string }> {
  if (!stickyPanel) return [];
  return stickyPanel.attachments.map((a) => ({
    id: a.id,
    filename: a.name,
  }));
}

// ─── Refresh Sticky Panel ────────────────────────────────────────────
async function refreshStickyPanel(): Promise<void> {
  if (!stickyPanel) return;
  if (refreshing) return;
  if (allTracks.length === 0) return;

  refreshing = true;
  try {
    const track = getCurrentTrack();
    const desiredImage = track?.imagePath ?? null;
    const imageChanged = desiredImage !== attachedImagePath;

    if (imageChanged && desiredImage) {
      const attachment = tryBuildAttachment(desiredImage);
      if (attachment) {
        const uploaded = await stickyPanel.edit({
          components: [
            buildPanelContainer(`attachment://${ATTACHMENT_NAME}`, allTracks),
          ],
          files: [attachment],
          flags: MessageFlags.IsComponentsV2,
        });
        stickyPanel = uploaded;
        attachedImagePath = desiredImage;
        lastImageCdnUrl = uploaded.attachments.first()?.url ?? null;
        console.log(`[PANEL] Image uploaded`);
        return;
      }
      attachedImagePath = desiredImage;
      lastImageCdnUrl = null;
    } else if (imageChanged && !desiredImage) {
      attachedImagePath = null;
      lastImageCdnUrl = null;
    }

    const currentUrl = stickyPanel.attachments.first()?.url ?? lastImageCdnUrl;
    const hasImage = currentUrl !== null || desiredImage !== null;

    const imageRef = hasImage
      ? (currentUrl ?? `attachment://${ATTACHMENT_NAME}`)
      : null;

    const editPayload: Parameters<Message['edit']>[0] = {
      components: [buildPanelContainer(imageRef, allTracks)],
      flags: MessageFlags.IsComponentsV2,
    };

    const preserved = preservedAttachments();
    if (preserved.length > 0) {
      editPayload.attachments = preserved;
    }

    stickyPanel = await stickyPanel.edit(editPayload);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 10008 || code === 10003) {
      console.warn('[PANEL] Panel deleted — recreating...');
      stickyPanel = null;
      attachedImagePath = null;
      lastImageCdnUrl = null;
      await recreateStickyPanel();
      return;
    }
    console.error(`[ERROR] refreshStickyPanel: ${err}`);
  } finally {
    refreshing = false;
  }
}

// ─── Recreate Sticky Panel ───────────────────────────────────────────
async function recreateStickyPanel(): Promise<void> {
  if (recreating) return;
  recreating = true;
  try {
    await ensureStickyPanel();
  } finally {
    recreating = false;
  }
}

// ─── Ensure Sticky Panel Exists ──────────────────────────────────────
async function ensureStickyPanel(): Promise<void> {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

  if (stickyPanel) return;

  try {
    const messages = await voiceChannel.messages.fetch({ limit: 30 });
    const existing = messages.find(
      (m) => m.author.id === client.user?.id && m.components.length > 0,
    );
    if (existing) {
      stickyPanel = existing;
      attachedImagePath = null;
      lastImageCdnUrl = null;
      console.log('[PANEL] Recovered existing sticky panel');
      if (allTracks.length > 0) {
        await refreshStickyPanel();
      }
      return;
    }
  } catch (err) {
    console.warn(`[WARN] Could not fetch VC messages: ${err}`);
  }

  if (allTracks.length === 0) {
    console.warn('[PANEL] Skipping creation — no tracks loaded yet');
    return;
  }

  try {
    stickyPanel = await voiceChannel.send({
      components: [buildPanelContainer(null, allTracks)],
      flags: MessageFlags.IsComponentsV2,
    });
    console.log('[PANEL] Sticky panel created');
    await refreshStickyPanel();
  } catch (err) {
    console.error(`[ERROR] Failed to create sticky panel: ${err}`);
  }
}

// ─── Welcome Message Builder ─────────────────────────────────────────
function buildWelcomeMessage(userId: string, totalMs: number): string {
  const totalStr = formatTotalTime(totalMs);
  return [
    `✦ ───── **Welcome to Naghm** ───── ✦`,
    ``,
    `🌙 **أهلاً وسهلاً** <@${userId}>`,
    `> A quiet corner, away from the noise`,
    `> زاوية هادئة، بعيدة عن الضجة`,
    ``,
    `<:time:1555563702382628885> **Time here** · \`${totalStr}\``,
    ``,
    `<:bed:1555627028525621248> **Sleep Mode** — auto-disconnect in 30 min`,
    `> وضع النوم — يقطع الاتصال تلقائياً بعد 30 دقيقة`,
    ``,
    `<:coin23Photoroom:1555556461004718240> **No coins earned here** · **لا تُكسب أي عملات هنا**`,
  ].join('\n');
}

async function sendWelcomeMessage(userId: string): Promise<void> {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

    const oldMsg = welcomeMessages.get(userId);
    if (oldMsg) {
      await oldMsg.delete().catch(() => {});
      welcomeMessages.delete(userId);
    }

    const sender = voiceChannel as unknown as {
      send: (options: { content: string }) => Promise<Message>;
    };
    if (typeof sender.send !== 'function') return;

    const totalMs = getTotalTimeMs(userId);
    const content = buildWelcomeMessage(userId, totalMs);

    const msg = await sender.send({ content });
    welcomeMessages.set(userId, msg);

    setTimeout(() => {
      const current = welcomeMessages.get(userId);
      if (current?.id === msg.id) {
        msg.delete().catch(() => {});
        welcomeMessages.delete(userId);
      }
    }, WELCOME_DELETE_AFTER);

    console.log(`[WELCOME] Sent to ${userId}`);
  } catch (err) {
    console.warn(`[WARN] Failed to send welcome message: ${err}`);
  }
}

async function deleteWelcomeMessage(userId: string): Promise<void> {
  const msg = welcomeMessages.get(userId);
  if (!msg) return;
  try {
    await msg.delete();
    console.log(`[WELCOME] Deleted for ${userId}`);
  } catch {
    // ignore
  }
  welcomeMessages.delete(userId);
}

// ─── Ready ───────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[READY] Bot logged in as ${readyClient.user.tag}`);

  loadEmojis();
  await validateEmojis(readyClient);
  console.log(`[EMOJI] Validation complete`);

  allTracks = await scanTracks();
  console.log(`[MUSIC] Loaded ${allTracks.length} tracks`);

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: getCommands(),
    });
    console.log('[COMMANDS] Slash commands registered');
  } catch (err) {
    console.error(`[ERROR] Failed to register commands: ${err}`);
  }

  try {
    const guild = readyClient.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error(`[ERROR] Guild not found`);

    const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!channel || !channel.isVoiceBased()) {
      return console.error(`[ERROR] Voice channel not found`);
    }

    const me = guild.members.me;
    if (!me) return console.error('[ERROR] Bot member not found');

    const permissions = channel.permissionsFor(me);
    if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
      return console.error('[ERROR] Bot lacks Connect or Speak permission');
    }

    updateTracks(allTracks);
    await joinVoice(guild, channel, allTracks);
    console.log('[VOICE] Connected to configured voice channel');
  } catch (err) {
    console.error(`[ERROR] Failed to join voice: ${err}`);
  }

  startStatusTimer(client);

  setOnPanelUpdate(() => {
    refreshStickyPanel().catch((err) => console.error(`[ERROR] Panel update: ${err}`));
  });

  setOnTrackChange(() => {
    refreshStickyPanel().catch((err) => console.error(`[ERROR] Track change: ${err}`));
  });

  setOnTrackEnd(() => {
    const next = getCurrentTrack();
    if (next) console.log(`[MUSIC] Next track: ${next.name}`);
  });

  await ensureStickyPanel();

  console.log('[READY] Bot is fully operational');
});

// ─── Welcome Live Update Timer ───────────────────────────────────────
setInterval(() => {
  if (welcomeMessages.size === 0) return;

  for (const [userId, msg] of welcomeMessages) {
    const totalMs = getTotalTimeMs(userId);
    const content = buildWelcomeMessage(userId, totalMs);
    msg.edit({ content }).catch(() => {
      welcomeMessages.delete(userId);
    });
  }
}, WELCOME_UPDATE_INTERVAL);

// ─── Auto-Recreate Sticky Panel When Deleted ─────────────────────────
client.on(Events.MessageDelete, async (message) => {
  if (!stickyPanel) return;
  if (message.id !== stickyPanel.id) return;

  console.log('[PANEL] Sticky panel deleted — recreating...');
  stickyPanel = null;
  attachedImagePath = null;
  lastImageCdnUrl = null;
  await recreateStickyPanel();
});

// ─── Voice State (Join / Leave) ──────────────────────────────────────
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const userId = newState.id;

  // ─── User left ──────────────────────────────────────────────────
  if (oldState.channelId === VOICE_CHANNEL_ID && newState.channelId !== VOICE_CHANNEL_ID) {
    recordLeave(userId);
    clearSleepTimer(userId);
    console.log(`[COOLDOWN] ${newState.member?.user.tag ?? userId} left voice`);

    await deleteWelcomeMessage(userId);
  }

  // ─── User joined (ignore bots) ──────────────────────────────────
  if (
    newState.channelId === VOICE_CHANNEL_ID &&
    oldState.channelId !== VOICE_CHANNEL_ID
  ) {
    if (newState.member?.user.bot) return;

    recordJoin(userId);
    console.log(`[COOLDOWN] ${newState.member?.user.tag ?? userId} joined voice (5m)`);

    await sendWelcomeMessage(userId);
  }
});

// ─── Interactions ────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmdName = interaction.commandName;
      if (cmdName === 'music-play' || cmdName === 'set-emoji') {
        await handleAutocomplete(interaction, allTracks);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'sleep_toggle') {
        await handleSleepButton(interaction);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'music':        await handleMusicCommand(interaction); break;
        case 'music-info':   await handleInfoCommand(interaction); break;
        case 'music-reload':
          await handleReloadCommand(interaction);
          allTracks = await scanTracks();
          updateTracks(allTracks);
          break;
        case 'music-skip':   await handleSkipCommand(interaction); break;
        case 'music-pause':  await handlePauseCommand(interaction); break;
        case 'music-stop':   await handleStopCommand(interaction); break;
        case 'music-play':   await handlePlayCommand(interaction, allTracks); break;
        case 'music-volume': await handleVolumeCommand(interaction); break;
        case 'set-emoji':    await handleSetEmojiCommand(interaction, allTracks); break;
        case 'list-emojis':  await handleListEmojisCommand(interaction); break;
        case 'clear-emojis': await handleClearEmojisCommand(interaction); break;
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_track') {
        await handleTrackSelect(interaction, allTracks);
      }
    }
  } catch (err) {
    console.error(`[ERROR] Interaction error: ${err}`);
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ **Something went wrong** · **حدث خطأ ما**\n\n> Please try again in a moment · يرجى المحاولة بعد قليل`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {}
  }
});

// ─── Panel Timer ─────────────────────────────────────────────────────
setInterval(() => {
  refreshStickyPanel().catch((err) => console.error(`[ERROR] Panel timer: ${err}`));
}, PANEL_UPDATE_INTERVAL);

// ─── Safety Check Every Minute ───────────────────────────────────────
setInterval(async () => {
  if (!stickyPanel) {
    await recreateStickyPanel();
    return;
  }
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!channel || !channel.isVoiceBased()) return;
    await channel.messages.fetch(stickyPanel.id);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 10008) {
      console.warn('[PANEL] Panel missing — recreating...');
      stickyPanel = null;
      attachedImagePath = null;
      lastImageCdnUrl = null;
      await recreateStickyPanel();
    }
  }
}, 60_000);

// ─── Memory Monitor (helps detect OOM on Render Free Tier) ───────────
setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  console.log(`[MEMORY] heap: ${heapMB} MB · rss: ${rssMB} MB`);
}, 10 * 60 * 1000);

// ─── Error Handling ──────────────────────────────────────────────────
client.on(Events.Error, (err) => console.error(`[ERROR] Client: ${err.message}`));
process.on('unhandledRejection', (err) => console.error(`[ERROR] Unhandled: ${err}`));
process.on('uncaughtException', (err) => console.error(`[ERROR] Uncaught: ${err.message}`));

// ─── Graceful Shutdown ───────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received — shutting down gracefully');
  stopWebServer();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received — shutting down gracefully');
  stopWebServer();
  client.destroy();
  process.exit(0);
});

// ─── Login with Full Diagnostics ─────────────────────────────────────
console.log('═══════════════════════════════════════════');
console.log('[BOOT] Starting Discord login...');
console.log(`[BOOT] Token length:    ${DISCORD_TOKEN.length} chars`);
console.log(`[BOOT] Token prefix:    ${DISCORD_TOKEN.slice(0, 10)}...`);
console.log(`[BOOT] Token has space: ${/\s/.test(DISCORD_TOKEN)}`);
console.log(`[BOOT] Client ID:       ${CLIENT_ID}`);
console.log(`[BOOT] Guild ID:        ${GUILD_ID}`);
console.log(`[BOOT] Voice Channel:   ${VOICE_CHANNEL_ID}`);
console.log('═══════════════════════════════════════════');

// ─── Test Discord REST API reachability ──────────────────────────────
(async () => {
  try {
    console.log('[BOOT] Testing Discord REST API connectivity...');
    const testRest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const start = Date.now();
    const me = (await testRest.get(Routes.user('@me'))) as {
      id?: string;
      username?: string;
    };
    const elapsed = Date.now() - start;
    console.log(
      `[BOOT] ✅ REST API reachable (${elapsed}ms) — user: ${me.username} (${me.id})`,
    );
    console.log('[BOOT] Network is fine. Problem is WebSocket Gateway or Intents.');
  } catch (err) {
    const e = err as { message?: string; code?: string; status?: number };
    console.error('═══════════════════════════════════════════');
    console.error('❌ REST API TEST FAILED');
    console.error(`Message: ${e.message ?? 'Unknown'}`);
    console.error(`Code:    ${e.code ?? 'N/A'}`);
    console.error(`Status:  ${e.status ?? 'N/A'}`);
    if (e.status === 401) {
      console.error('🔑 TOKEN IS INVALID (401 Unauthorized)');
    }
    if (e.status === 429) {
      console.error('⚠️  RATE LIMITED (429) — Shared IP blocked by Discord');
      console.error('   → Solution: Use dedicated IP or different host');
    }
    console.error('═══════════════════════════════════════════');
  }
})();

// ─── Login with timeout ──────────────────────────────────────────────
console.log('[BOOT] Calling client.login()...');

const loginTimeout = setTimeout(() => {
  console.error('═══════════════════════════════════════════');
  console.error('❌ LOGIN TIMEOUT — no response after 30 seconds');
  console.error('═══════════════════════════════════════════');
  console.error('Possible causes:');
  console.error('  1. Intents are disabled in Developer Portal');
  console.error('  2. Render\'s IP is blocked by Discord (rate limit)');
  console.error('  3. Discord Gateway is unreachable');
  console.error('');
  console.error('Diagnostics:');
  console.error('  → Check [DEBUG] / [WARN] logs above for 429 errors');
  console.error('  → Solution: Move to a host with a dedicated IP');
  console.error('═══════════════════════════════════════════');
}, 30_000);

client
  .login(DISCORD_TOKEN)
  .then(() => {
    clearTimeout(loginTimeout);
    console.log('[BOOT] ✅ client.login() resolved successfully');
  })
  .catch((err: unknown) => {
    clearTimeout(loginTimeout);
    const error = err as { message?: string; code?: string };
    console.error('═══════════════════════════════════════════');
    console.error('❌ LOGIN FAILED');
    console.error('═══════════════════════════════════════════');
    console.error(`Message: ${error.message ?? 'Unknown'}`);
    console.error(`Code:    ${error.code ?? 'N/A'}`);
    console.error('');

    if (
      error.message?.includes('TOKEN_INVALID') ||
      error.message?.includes('An invalid token')
    ) {
      console.error('🔑 DISCORD_TOKEN IS INVALID!');
      console.error('   → Render Dashboard → Environment → Update DISCORD_TOKEN');
    }

    if (error.message?.includes('disallowed intents')) {
      console.error('🔒 INTENTS ISSUE!');
      console.error('   → Developer Portal → Bot → Enable ALL Privileged Intents');
    }

    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      console.error('⚠️  RATE LIMITED!');
      console.error('   → Render Shared IP is blocked');
      console.error('   → Solution: Move to a dedicated IP host');
    }

    console.error('═══════════════════════════════════════════');
  });