import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { EMBED_COLOR, Track } from './config.js';
import { getProgressBar, formatTime } from './utils.js';
import {
  getCurrentTrack,
  getElapsed,
  getDuration,
} from './musicPlayer.js';
import { getEmojiForTrack, isEmojiIdValid } from './emojiStore.js';

const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;

export const ATTACHMENT_NAME = 'track_image.gif';

// ─── Safe Attachment ─────────────────────────────────────────────────
export function tryBuildAttachment(imagePath: string): AttachmentBuilder | null {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`[WARN] Image not found: ${imagePath}`);
      return null;
    }
    const stats = fs.statSync(imagePath);
    if (stats.size > MAX_ATTACHMENT_SIZE) {
      console.warn(
        `[WARN] Image too large (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${path.basename(imagePath)}`,
      );
      return null;
    }
    return new AttachmentBuilder(imagePath, { name: ATTACHMENT_NAME });
  } catch (err) {
    console.warn(`[WARN] Failed to build attachment: ${err}`);
    return null;
  }
}

// ─── Resolve Emoji (for options list) ────────────────────────────────
// Returns the track's own emoji — object form for custom, string for unicode.
function resolveEmoji(trackName: string): string | { id: string } {
  const stored = getEmojiForTrack(trackName);
  if (!stored) return '🎵';

  if (/^\d{15,25}$/.test(stored)) {
    if (isEmojiIdValid(stored)) return { id: stored };
    return '🎵';
  }

  return stored;
}

// ─── Build Track Select Row ──────────────────────────────────────────
// The currently-playing track is marked as `default: true`. Discord then
// renders that option (with its custom emoji) in the collapsed state —
// this is the only way to display a custom emoji "inside" the menu.
function buildTrackSelectRow(
  tracks: Track[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const current = getCurrentTrack();
  const currentId = current?.id ?? null;

  const options = tracks.map((track) => ({
    label: track.name.slice(0, 100),
    value: track.id,
    emoji: resolveEmoji(track.name),
    default: track.id === currentId,
  }));

  if (options.length > 25) {
    console.warn(`[WARN] ${options.length} tracks exceed limit (25). Truncating.`);
    options.splice(25);
  }

  // Placeholder is shown only when nothing is currently playing.
  // When a track is playing, the default option's custom emoji is displayed.
  const placeholder = current ? ' ' : 'اختر أغنية 🎵';

  const select = new StringSelectMenuBuilder()
    .setCustomId('select_track')
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

// ─── Sleep Button ────────────────────────────────────────────────────
function buildSleepButtonRow(): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId('sleep_toggle')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji({ id: '1555627028525621248' });

  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

// ─── Build Panel Container ───────────────────────────────────────────
export function buildPanelContainer(
  imageRef: string | null,
  tracks: Track[],
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(EMBED_COLOR);

  if (imageRef) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageRef),
      ),
    );
  }

  const track = getCurrentTrack();
  if (track) {
    const elapsed = getElapsed();
    const duration = getDuration();
    const bar = getProgressBar(elapsed, duration);
    const elapsedStr = formatTime(elapsed);
    const totalStr = formatTime(duration);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${bar}   \`${elapsedStr} / ${totalStr}\``),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**لا توجد أغنية قيد التشغيل حالياً**'),
    );
  }

  container.addActionRowComponents(buildTrackSelectRow(tracks));
  container.addActionRowComponents(buildSleepButtonRow());

  return container;
}