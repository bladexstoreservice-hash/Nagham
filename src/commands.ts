import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
  AutocompleteInteraction,
} from 'discord.js';
import {
  VOICE_CHANNEL_ID,
  FIRST_CHANGE_COOLDOWN,
  NEXT_CHANGE_COOLDOWN,
  Track,
} from './config.js';
import {
  playTrack,
  updateTracks,
  skip,
  pause,
  resume,
  stopPlayback,
  setVolume,
  getVolume,
  isPaused,
  getCurrentTrack,
} from './musicPlayer.js';
import { formatRemaining, scanTracks } from './utils.js';
import {
  setEmojiForTrack,
  getAllEmojis,
  clearAllEmojis,
} from './emojiStore.js';

// ─── Bilingual helper ────────────────────────────────────────────────
function bi(title: string, subtitle: string, extra?: string): string {
  const lines = [title, ``, `> ${subtitle}`];
  if (extra) lines.push(``, extra);
  return lines.join('\n');
}

let onPanelUpdate: (() => void) | null = null;
export function setOnPanelUpdate(cb: () => void): void {
  onPanelUpdate = cb;
}
function requestPanelUpdate(): void {
  if (onPanelUpdate) onPanelUpdate();
}

// ─── Session Store ───────────────────────────────────────────────────
export type UserSession = {
  joinedAt: number;
  lastChangeAt?: number;
  totalTimeMs: number;
  inChannel: boolean;
};

export const sessions = new Map<string, UserSession>();

// ─── Sleep Mode Timers ───────────────────────────────────────────────
export const SLEEP_DURATION_MS = 30 * 60 * 1000;
export const sleepTimers = new Map<string, NodeJS.Timeout>();

export function clearSleepTimer(userId: string): void {
  const t = sleepTimers.get(userId);
  if (t) {
    clearTimeout(t);
    sleepTimers.delete(userId);
  }
}

// ─── Session Helpers ─────────────────────────────────────────────────
export function getSession(userId: string): UserSession | undefined {
  return sessions.get(userId);
}

export function recordJoin(userId: string): number {
  const existing = sessions.get(userId);
  if (existing) {
    existing.joinedAt = Date.now();
    existing.lastChangeAt = undefined;
    existing.inChannel = true;
    return existing.totalTimeMs;
  }
  const fresh: UserSession = {
    joinedAt: Date.now(),
    totalTimeMs: 0,
    inChannel: true,
  };
  sessions.set(userId, fresh);
  return 0;
}

export function recordLeave(userId: string): void {
  const s = sessions.get(userId);
  if (!s || !s.inChannel) return;
  s.totalTimeMs += Date.now() - s.joinedAt;
  s.inChannel = false;
}

export function getTotalTimeMs(userId: string): number {
  const s = sessions.get(userId);
  if (!s) return 0;
  const accumulated = s.totalTimeMs;
  const live = s.inChannel ? Date.now() - s.joinedAt : 0;
  return accumulated + live;
}

// ─── Slash Command Definitions ───────────────────────────────────────
export function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName('music')
      .setDescription('Show the music panel location · معلومات لوحة التحكم')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-reload')
      .setDescription('Reload the track list · إعادة تحميل الأغاني (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-skip')
      .setDescription('Skip the current track · تخطي الأغنية (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-pause')
      .setDescription('Pause / resume · إيقاف مؤقت أو استئناف (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-stop')
      .setDescription('Stop playback · إيقاف التشغيل (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-play')
      .setDescription('Play a specific track · تشغيل أغنية معينة (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((opt) =>
        opt
          .setName('track')
          .setDescription('Track name · اسم الأغنية')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-volume')
      .setDescription('Set the volume · ضبط الصوت (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addIntegerOption((opt) =>
        opt
          .setName('level')
          .setDescription('Volume 1-200 · مستوى الصوت')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(200),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('music-info')
      .setDescription('Info about the current track · معلومات الأغنية الحالية')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('set-emoji')
      .setDescription('Set a custom emoji · تعيين أيقونة (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((opt) =>
        opt
          .setName('track')
          .setDescription('Choose a track · اختر الأغنية')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('emoji')
          .setDescription('Emoji ID or unicode — leave empty to remove')
          .setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('list-emojis')
      .setDescription('List all custom emojis · عرض الأيقونات (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('clear-emojis')
      .setDescription('Remove ALL custom track emojis · حذف كل الأيقونات (Admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────
export function isUserInVoiceChannel(
  interaction:
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction,
): boolean {
  const member = interaction.member;
  if (!member) return false;
  const voiceChannelId =
    'voice' in member && member.voice ? member.voice.channelId : null;
  return voiceChannelId === VOICE_CHANNEL_ID;
}

export function isAdmin(
  interaction:
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction,
): boolean {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.Administrator);
}

export function checkCooldown(
  userId: string,
  admin: boolean,
): { allowed: boolean; remaining?: number } {
  if (admin) return { allowed: true };

  const session = sessions.get(userId);
  if (!session || !session.inChannel) {
    return { allowed: false, remaining: FIRST_CHANGE_COOLDOWN };
  }

  const now = Date.now();

  if (session.lastChangeAt === undefined) {
    const elapsed = now - session.joinedAt;
    if (elapsed < FIRST_CHANGE_COOLDOWN) {
      return { allowed: false, remaining: FIRST_CHANGE_COOLDOWN - elapsed };
    }
    return { allowed: true };
  }

  const elapsed = now - session.lastChangeAt;
  if (elapsed < NEXT_CHANGE_COOLDOWN) {
    return { allowed: false, remaining: NEXT_CHANGE_COOLDOWN - elapsed };
  }
  return { allowed: true };
}

export function recordChange(userId: string): void {
  const session = sessions.get(userId);
  if (session) {
    session.lastChangeAt = Date.now();
  }
}

// ─── Sleep Button Handler ────────────────────────────────────────────
export async function handleSleepButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  if (!isUserInVoiceChannel(interaction)) {
    await interaction.reply({
      content: bi(
        `🎧 **Voice channel required** · **الروم الصوتي مطلوب**`,
        `Join the voice channel to use Sleep Mode — انضم للروم الصوتي لاستخدام وضع النوم`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = sleepTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
    sleepTimers.delete(userId);
    await interaction.reply({
      content: bi(
        `☀️ **Sleep Mode cancelled** · **تم إلغاء وضع النوم**`,
        `You'll stay in the channel — ستبقى في القناة`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    console.log(`[SLEEP] ${interaction.user.tag} cancelled sleep mode`);
    return;
  }

  const timeout = setTimeout(async () => {
    sleepTimers.delete(userId);
    try {
      const guild = interaction.guild;
      if (!guild) return;
      const member = await guild.members.fetch(userId);
      if (member.voice.channelId === VOICE_CHANNEL_ID) {
        await member.voice.disconnect('Sleep Mode — 30 minutes elapsed');
        console.log(`[SLEEP] Disconnected ${interaction.user.tag}`);
      }
    } catch (err) {
      console.warn(`[WARN] Sleep disconnect failed: ${err}`);
    }
  }, SLEEP_DURATION_MS);

  sleepTimers.set(userId, timeout);

  await interaction.reply({
    content: bi(
      `💤 **Sleep Mode activated** · **تم تفعيل وضع النوم**`,
      `You'll be gently disconnected in **30 minutes** — سيتم فصلك بلطف بعد **30 دقيقة**`,
      `🌙 Sleep well · نم جيداً`,
    ),
    flags: MessageFlags.Ephemeral,
  });
  console.log(`[SLEEP] ${interaction.user.tag} activated sleep mode (30m)`);
}

// ─── /music ──────────────────────────────────────────────────────────
export async function handleMusicCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    content: bi(
      `🎵 **Music panel is pinned** · **لوحة التحكم مثبتة**`,
      `Find it in the voice channel's chat — ستجدها في شات الروم الصوتي <#${VOICE_CHANNEL_ID}>`,
    ),
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /music-info ─────────────────────────────────────────────────────
export async function handleInfoCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const track = getCurrentTrack();
  if (!track) {
    await interaction.reply({
      content: bi(
        `⏹️ **Nothing is playing** · **لا شيء قيد التشغيل**`,
        `The player is taking a break — المشغل في راحة الآن`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const statusLine = isPaused()
    ? `⏸️ **Paused** · **متوقفة مؤقتاً**`
    : `▶️ **Playing** · **قيد التشغيل**`;

  await interaction.reply({
    content: bi(
      `🎵 **Now playing** · **الأغنية الحالية**`,
      `**${track.name}**`,
      statusLine,
    ),
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Track Select (with defer) ───────────────────────────────────────
export async function handleTrackSelect(
  interaction: StringSelectMenuInteraction,
  allTracks: Track[],
): Promise<void> {
  const userId = interaction.user.id;

  // ⚡ DEFER IMMEDIATELY to prevent "Unknown interaction" (10062)
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    // Interaction already expired — nothing we can do
    return;
  }

  if (!isUserInVoiceChannel(interaction)) {
    await interaction.editReply({
      content: bi(
        `🎧 **Voice channel required** · **الروم الصوتي مطلوب**`,
        `Join the voice channel to use this feature — انضم للروم الصوتي للاستخدام`,
      ),
    });
    return;
  }

  const selectedId = interaction.values[0];
  const track = allTracks.find((t) => t.id === selectedId);
  if (!track) {
    await interaction.editReply({
      content: bi(
        `🔍 **Track not found** · **الأغنية غير موجودة**`,
        `The selected track is unavailable — الأغنية المحددة غير متوفرة`,
      ),
    });
    return;
  }

  const admin = isAdmin(interaction);
  const cooldown = checkCooldown(userId, admin);

  if (!cooldown.allowed) {
    await interaction.editReply({
      content: bi(
        `⏳ **Music is already playing** · **الموسيقى شغّالة الآن**`,
        `Sit back & enjoy the current vibe — استرخِ واستمتع بالأجواء الحالية`,
        `**Try again in** · **حاول مجدداً بعد** · \`${formatRemaining(cooldown.remaining!)}\``,
      ),
    });
    return;
  }

  playTrack(track);
  recordChange(userId);

  await interaction.editReply({
    content: bi(
      `🎵 **Now playing** · **قيد التشغيل الآن**`,
      `**${track.name}**`,
    ),
  });

  console.log(`[MUSIC] ${interaction.user.tag} changed track to: ${track.name}`);
  requestPanelUpdate();
}

// ─── /music-reload ───────────────────────────────────────────────────
export async function handleReloadCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: bi(
        `🔒 **Admins only** · **للمدراء فقط**`,
        `You don't have permission — لا تملك الصلاحية`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const tracks = await scanTracks();
    updateTracks(tracks);
    await interaction.editReply({
      content: bi(
        `♻️ **Reloaded successfully** · **تم إعادة التحميل بنجاح**`,
        `${tracks.length} tracks are ready to play — ${tracks.length} أغنية جاهزة للتشغيل`,
      ),
    });
    console.log(`[MUSIC] Reloaded ${tracks.length} tracks`);
    requestPanelUpdate();
  } catch (err) {
    await interaction.editReply({
      content: bi(
        `❌ **Reload failed** · **فشل إعادة التحميل**`,
        `Could not reload the track list — لم نتمكن من إعادة تحميل القائمة`,
      ),
    });
  }
}

// ─── /music-skip ─────────────────────────────────────────────────────
export async function handleSkipCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  skip();
  await interaction.reply({
    content: bi(
      `⏭️ **Track skipped** · **تم تخطي الأغنية**`,
      `Moving to the next vibe — ننتقل إلى الأجواء التالية`,
    ),
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /music-pause ────────────────────────────────────────────────────
export async function handlePauseCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (isPaused()) {
    resume();
    await interaction.reply({
      content: bi(
        `▶️ **Resumed** · **تم الاستئناف**`,
        `The music is back — عادت الموسيقى`,
      ),
      flags: MessageFlags.Ephemeral,
    });
  } else {
    const ok = pause();
    await interaction.reply({
      content: ok
        ? bi(
            `⏸️ **Paused** · **تم الإيقاف المؤقت**`,
            `The music is taking a break — الموسيقى تأخذ استراحة`,
          )
        : bi(
            `⚠️ **Nothing to pause** · **لا يوجد شيء للإيقاف**`,
            `No track is currently playing — لا توجد أغنية قيد التشغيل`,
          ),
      flags: MessageFlags.Ephemeral,
    });
  }
  requestPanelUpdate();
}

// ─── /music-stop ─────────────────────────────────────────────────────
export async function handleStopCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  stopPlayback();
  await interaction.reply({
    content: bi(
      `⏹️ **Playback stopped** · **تم إيقاف التشغيل**`,
      `The music has been silenced — تم إسكات الموسيقى`,
    ),
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /music-play ─────────────────────────────────────────────────────
export async function handlePlayCommand(
  interaction: ChatInputCommandInteraction,
  allTracks: Track[],
): Promise<void> {
  const query = interaction.options.getString('track', true);
  const track =
    allTracks.find((t) => t.id === query) ??
    allTracks.find((t) => t.name === query);

  if (!track) {
    await interaction.reply({
      content: bi(
        `🔍 **Track not found** · **الأغنية غير موجودة**`,
        `The selected track is unavailable — الأغنية المحددة غير متوفرة`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  playTrack(track);
  await interaction.reply({
    content: bi(
      `🎵 **Now playing** · **قيد التشغيل الآن**`,
      `**${track.name}**`,
    ),
    flags: MessageFlags.Ephemeral,
  });
  requestPanelUpdate();
}

// ─── /music-volume ───────────────────────────────────────────────────
export async function handleVolumeCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const level = interaction.options.getInteger('level', true);
  const applied = setVolume(level);
  await interaction.reply({
    content: bi(
      `🔊 **Volume adjusted** · **تم ضبط الصوت**`,
      `Level set to **${applied}%** — المستوى الآن **${applied}%**`,
    ),
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Autocomplete ────────────────────────────────────────────────────
export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  allTracks: Track[],
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const matches = allTracks
    .filter((t) => t.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((t) => ({ name: t.name.slice(0, 100), value: t.id }));

  await interaction.respond(matches);
}

// ─── /set-emoji ──────────────────────────────────────────────────────
export async function handleSetEmojiCommand(
  interaction: ChatInputCommandInteraction,
  allTracks: Track[],
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: bi(
        `🔒 **Admins only** · **للمدراء فقط**`,
        `You don't have permission — لا تملك الصلاحية`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const trackInput = interaction.options.getString('track', true);
  const emojiInput = interaction.options.getString('emoji');

  const track =
    allTracks.find((t) => t.id === trackInput) ??
    allTracks.find((t) => t.name === trackInput);

  if (!track) {
    await interaction.reply({
      content: bi(
        `🔍 **Track not found** · **الأغنية غير موجودة**`,
        `Could not find that track — لم نتمكن من العثور على الأغنية`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!emojiInput || emojiInput.trim() === '') {
    setEmojiForTrack(track.name, null);
    await interaction.reply({
      content: bi(
        `🗑️ **Emoji removed** · **تم حذف الأيقونة**`,
        `**${track.name}** will show 🎵 by default — ستظهر بـ 🎵 افتراضياً`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    console.log(`[EMOJI] Removed emoji for: ${track.name}`);
    requestPanelUpdate();
    return;
  }

  const trimmed = emojiInput.trim();
  let storedValue: string;

  const customMatch = trimmed.match(/^<a?:[A-Za-z0-9_]+:(\d{15,25})>$/);
  if (customMatch && customMatch[1]) {
    storedValue = customMatch[1];
  } else if (/^\d{15,25}$/.test(trimmed)) {
    storedValue = trimmed;
  } else {
    storedValue = trimmed;
  }

  setEmojiForTrack(track.name, storedValue);

  const preview = /^\d+$/.test(storedValue)
    ? `<:emoji:${storedValue}>`
    : storedValue;

  await interaction.reply({
    content: bi(
      `✅ **Emoji set** · **تم تعيين الأيقونة**`,
      `${preview} → **${track.name}**`,
    ),
    flags: MessageFlags.Ephemeral,
  });

  console.log(`[EMOJI] Set "${storedValue}" for: ${track.name}`);
  requestPanelUpdate();
}

// ─── /list-emojis ────────────────────────────────────────────────────
export async function handleListEmojisCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const all = getAllEmojis();
  const entries = Object.entries(all);

  if (entries.length === 0) {
    await interaction.reply({
      content: bi(
        `📭 **No custom emojis yet** · **لا توجد أيقونات مخصصة**`,
        `Use \`/set-emoji\` to add one — استخدم \`/set-emoji\` لإضافة واحدة`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = entries.map(([name, val]) => {
    const preview = /^\d+$/.test(val) ? `<:emoji:${val}>` : val;
    return `${preview}  →  ${name}`;
  });

  const header = `🎨 **Custom emojis** · **الأيقونات المخصصة** (${entries.length})\n\n`;
  const content = header + lines.join('\n');
  const truncated = content.length > 1900 ? content.slice(0, 1900) + '\n…' : content;

  await interaction.reply({
    content: truncated,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /clear-emojis ───────────────────────────────────────────────────
export async function handleClearEmojisCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: bi(
        `🔒 **Admins only** · **للمدراء فقط**`,
        `You don't have permission — لا تملك الصلاحية`,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const count = clearAllEmojis();

  await interaction.reply({
    content: bi(
      `🧹 **All emojis cleared** · **تم حذف جميع الأيقونات**`,
      `Removed ${count} mappings — تم حذف ${count} تعيين`,
      `Tracks will now show the default 🎵 — ستظهر الأغاني بالأيقونة الافتراضية 🎵`,
    ),
    flags: MessageFlags.Ephemeral,
  });

  console.log(`[EMOJI] Cleared all ${count} emojis`);
  requestPanelUpdate();
}