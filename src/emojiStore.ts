import fs from 'node:fs';
import path from 'node:path';
import { PermissionFlagsBits, type Client } from 'discord.js';
import { PROJECT_ROOT, GUILD_ID } from './config.js';

const EMOJI_FILE = path.join(PROJECT_ROOT, 'emojis.json');

let cache: Record<string, string> = {};
const validEmojiIds = new Set<string>();
const emojiNames = new Map<string, string>(); // id → name

// ─── Load from disk (with backup recovery) ───────────────────────────
export function loadEmojis(): void {
  const backupFile = `${EMOJI_FILE}.backup`;

  try {
    if (fs.existsSync(EMOJI_FILE)) {
      const raw = fs.readFileSync(EMOJI_FILE, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const asRecord = parsed as Record<string, string>;
        const count = Object.keys(asRecord).length;

        if (count === 0 && fs.existsSync(backupFile)) {
          try {
            const backupRaw = fs.readFileSync(backupFile, 'utf-8');
            const backupParsed: unknown = JSON.parse(backupRaw);
            if (
              backupParsed &&
              typeof backupParsed === 'object' &&
              !Array.isArray(backupParsed)
            ) {
              const backupRecord = backupParsed as Record<string, string>;
              const backupCount = Object.keys(backupRecord).length;
              if (backupCount > 0) {
                cache = backupRecord;
                console.log(
                  `[EMOJI] Main file empty — recovered ${backupCount} from backup`,
                );
                persist();
                return;
              }
            }
          } catch {
            // ignore
          }
        }

        cache = asRecord;
      } else {
        cache = {};
      }
      console.log(`[EMOJI] Loaded ${Object.keys(cache).length} mappings`);
    } else if (fs.existsSync(backupFile)) {
      try {
        const backupRaw = fs.readFileSync(backupFile, 'utf-8');
        const backupParsed: unknown = JSON.parse(backupRaw);
        if (
          backupParsed &&
          typeof backupParsed === 'object' &&
          !Array.isArray(backupParsed)
        ) {
          cache = backupParsed as Record<string, string>;
          console.log(`[EMOJI] Recovered ${Object.keys(cache).length} from backup`);
          persist();
          return;
        }
      } catch {
        // ignore
      }
      cache = {};
    } else {
      cache = {};
      console.log('[EMOJI] No emojis.json found (starting fresh)');
    }
  } catch (err) {
    console.warn(`[WARN] Failed to load emojis: ${err}`);
    cache = {};
  }
}

// ─── Persist (with rolling backup) ───────────────────────────────────
function persist(): void {
  try {
    if (fs.existsSync(EMOJI_FILE)) {
      try {
        const existing = fs.readFileSync(EMOJI_FILE, 'utf-8');
        if (existing.trim() !== '{}' && existing.trim().length > 5) {
          fs.writeFileSync(`${EMOJI_FILE}.backup`, existing, 'utf-8');
        }
      } catch {
        // ignore
      }
    }
    fs.writeFileSync(EMOJI_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[ERROR] Failed to save emojis: ${err}`);
  }
}

// ─── Read ────────────────────────────────────────────────────────────
export function getEmojiForTrack(trackName: string): string | null {
  return cache[trackName] ?? null;
}

// ─── Read name ───────────────────────────────────────────────────────
export function getEmojiName(id: string): string | null {
  return emojiNames.get(id) ?? null;
}

// ─── Write ───────────────────────────────────────────────────────────
export function setEmojiForTrack(trackName: string, value: string | null): void {
  if (value === null || value === '') {
    delete cache[trackName];
  } else {
    cache[trackName] = value;
  }
  persist();
}

// ─── List all ────────────────────────────────────────────────────────
export function getAllEmojis(): Record<string, string> {
  return { ...cache };
}

// ─── Remove all ──────────────────────────────────────────────────────
export function clearAllEmojis(): number {
  const count = Object.keys(cache).length;
  cache = {};
  persist();
  return count;
}

// ─── Collect Application Emojis (with names) ─────────────────────────
async function collectApplicationEmojis(
  client: Client,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const app = client.application;
  if (!app) return map;

  try {
    const collection = await app.emojis.fetch();
    for (const emoji of collection.values()) {
      if (emoji?.id) map.set(emoji.id, emoji.name ?? 'emoji');
    }
  } catch {
    try {
      const data = (await client.rest.get(
        `/applications/${app.id}/emojis`,
      )) as { items?: Array<{ id: string; name: string }> };
      if (data.items) {
        for (const item of data.items) {
          if (item.id) map.set(item.id, item.name ?? 'emoji');
        }
      }
    } catch (restErr) {
      console.warn(`[EMOJI] Failed to fetch application emojis: ${restErr}`);
    }
  }

  return map;
}

// ─── Validate — NON-DESTRUCTIVE ──────────────────────────────────────
export async function validateEmojis(client: Client): Promise<void> {
  validEmojiIds.clear();
  emojiNames.clear();

  const targetGuild = client.guilds.cache.get(GUILD_ID);
  if (!targetGuild) {
    console.warn(`[EMOJI] Target guild ${GUILD_ID} not cached — skipping`);
    return;
  }

  const me = targetGuild.members.me;
  const canUseExternal =
    me?.permissions.has(PermissionFlagsBits.UseExternalEmojis) ?? false;

  console.log(
    `[EMOJI] Use External Emojis: ${canUseExternal ? 'YES ✅' : 'NO ❌'}`,
  );

  // Collect guild emojis (with names)
  const guildEmojiMap = new Map<string, string>();
  for (const guild of client.guilds.cache.values()) {
    try {
      const emojis = await guild.emojis.fetch();
      for (const emoji of emojis.values()) {
        if (emoji?.id) {
          guildEmojiMap.set(emoji.id, emoji.name ?? 'emoji');
        }
      }
    } catch (err) {
      console.warn(`[EMOJI] Failed to fetch emojis for guild ${guild.id}: ${err}`);
    }
  }

  // Collect application emojis (with names)
  const appEmojiMap = await collectApplicationEmojis(client);

  console.log(
    `[EMOJI] Found ${guildEmojiMap.size} guild emojis + ${appEmojiMap.size} application emojis`,
  );

  // Build allowed set + names
  const allowedIds = new Set<string>();

  for (const [id, name] of appEmojiMap) {
    allowedIds.add(id);
    emojiNames.set(id, name);
  }

  try {
    const targetEmojis = await targetGuild.emojis.fetch();
    for (const emoji of targetEmojis.values()) {
      if (emoji?.id) {
        allowedIds.add(emoji.id);
        emojiNames.set(emoji.id, emoji.name ?? 'emoji');
      }
    }
  } catch (err) {
    console.warn(`[EMOJI] Failed to fetch target guild emojis: ${err}`);
  }

  if (canUseExternal) {
    for (const [id, name] of guildEmojiMap) {
      allowedIds.add(id);
      if (!emojiNames.has(id)) emojiNames.set(id, name);
    }
  }

  // Validate
  const entries = Object.entries(cache);
  let valid = 0;
  let fallback = 0;

  for (const [, value] of entries) {
    if (!/^\d{15,25}$/.test(value)) {
      valid++;
      continue;
    }

    if (allowedIds.has(value)) {
      validEmojiIds.add(value);
      valid++;
    } else {
      fallback++;
    }
  }

  console.log(
    `[EMOJI] Validated: ${valid} active, ${fallback} will fallback to 🎵`,
  );

  if (fallback > 0) {
    console.warn(
      `[EMOJI] ${fallback} emoji(s) could not be resolved — they will use 🎵`,
    );
  }
}

// ─── Quick check for panel ───────────────────────────────────────────
export function isEmojiIdValid(id: string): boolean {
  return validEmojiIds.has(id);
}