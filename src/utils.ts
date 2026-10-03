import fs from 'node:fs';
import path from 'node:path';
import {
  MUSIC_DIR,
  IMAGES_DIR,
  PROJECT_ROOT,
  Track,
  BAR_LEFT_FILLED,
  BAR_LEFT_EMPTY,
  BAR_MID_FILLED,
  BAR_MID_EMPTY,
  BAR_RIGHT_FILLED,
  BAR_RIGHT_EMPTY,
} from './config.js';
import { parseFile } from 'music-metadata';

// ─── Order File Path ─────────────────────────────────────────────────
const ORDER_FILE = path.join(PROJECT_ROOT, 'order.json');

// ─── Supported Audio Extensions ──────────────────────────────────────
const AUDIO_EXTENSIONS = ['.mp3', '.opus', '.ogg'];

// ─── MM:SS / HH:MM:SS ────────────────────────────────────────────────
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Total time format: 14h 48m 59s ──────────────────────────────────
export function formatTotalTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ─── Progress Bar (10 Emojis, left → right) ──────────────────────────
export function getProgressBar(elapsed: number, duration: number): string {
  let filled: number;
  if (duration <= 0) {
    filled = 0;
  } else {
    const progress = Math.min(Math.max(elapsed / duration, 0), 1);
    filled = Math.min(Math.max(Math.floor(progress * 10), 0), 10);
  }

  let bar = '';
  for (let i = 0; i < 10; i++) {
    if (i === 0) {
      bar += i < filled ? BAR_LEFT_FILLED : BAR_LEFT_EMPTY;
    } else if (i === 9) {
      bar += i < filled ? BAR_RIGHT_FILLED : BAR_RIGHT_EMPTY;
    } else {
      bar += i < filled ? BAR_MID_FILLED : BAR_MID_EMPTY;
    }
  }
  return bar;
}

// ─── Random Track ────────────────────────────────────────────────────
export function getRandomTrack(tracks: Track[], exclude?: Track | null): Track {
  if (tracks.length === 0) throw new Error('No tracks available');
  if (tracks.length === 1) return tracks[0]!;

  let candidates = tracks;
  if (exclude) {
    candidates = tracks.filter((t) => t.id !== exclude.id);
    if (candidates.length === 0) candidates = tracks;
  }
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

// ─── Load Custom Order ───────────────────────────────────────────────
function loadCustomOrder(): string[] {
  try {
    if (!fs.existsSync(ORDER_FILE)) return [];
    const raw = fs.readFileSync(ORDER_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[WARN] order.json must be an array of track names');
      return [];
    }
    const filtered = parsed.filter((x): x is string => typeof x === 'string');
    if (filtered.length !== parsed.length) {
      console.warn('[WARN] order.json contains non-string entries — filtered out');
    }
    return filtered;
  } catch (err) {
    console.warn(`[WARN] Failed to load order.json: ${err}`);
    return [];
  }
}

// ─── Helper: strip audio extension from filename ─────────────────────
function stripAudioExtension(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
  }
  return filename;
}

// ─── Scan Tracks (with custom order support) ─────────────────────────
export async function scanTracks(): Promise<Track[]> {
  if (!fs.existsSync(MUSIC_DIR)) {
    console.warn(`[WARN] Music directory not found: ${MUSIC_DIR}`);
    return [];
  }

  const files = fs.readdirSync(MUSIC_DIR);
  const audioFiles = files.filter((f) => {
    const lower = f.toLowerCase();
    return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
  });

  if (audioFiles.length === 0) {
    console.warn('[WARN] No audio files found');
    return [];
  }

  // ─── Build image map (priority: gif > png > jpg > jpeg) ──────────
  const imageMap = new Map<string, string>();
  if (fs.existsSync(IMAGES_DIR)) {
    const imageFiles = fs.readdirSync(IMAGES_DIR);
    const priority = ['.gif', '.png', '.jpg', '.jpeg'];
    for (const ext of priority) {
      for (const file of imageFiles) {
        if (file.toLowerCase().endsWith(ext)) {
          const baseName = file.slice(0, -ext.length);
          if (!imageMap.has(baseName)) {
            imageMap.set(baseName, path.join(IMAGES_DIR, file));
          }
        }
      }
    }

    // Warn about orphan images
    for (const [baseName] of imageMap) {
      const hasMatch = audioFiles.some(
        (f) => stripAudioExtension(f) === baseName,
      );
      if (!hasMatch) {
        console.warn(`[WARN] Image without matching music: ${baseName}`);
      }
    }
  }

  // ─── Read metadata for each track ────────────────────────────────
  const tracks: Track[] = [];

  for (const file of audioFiles) {
    const name = stripAudioExtension(file);
    const audioPath = path.join(MUSIC_DIR, file);
    const imagePath = imageMap.get(name);

    if (!imagePath) console.warn(`[WARN] No image found for track: ${name}`);

    let duration: number | undefined;
    try {
      const metadata = await parseFile(audioPath);
      duration = metadata.format.duration ?? undefined;
    } catch (err) {
      console.warn(`[WARN] Failed to read metadata for ${name}: ${err}`);
    }

    tracks.push({
      id: Buffer.from(name).toString('base64url').slice(0, 100),
      name,
      audioPath,
      imagePath,
      duration,
    });
  }

  // ─── Apply custom order (from order.json) ────────────────────────
  const customOrder = loadCustomOrder();

  if (customOrder.length > 0) {
    const positionMap = new Map<string, number>();
    customOrder.forEach((name, idx) => positionMap.set(name, idx));

    const trackNames = new Set(tracks.map((t) => t.name));
    for (const name of customOrder) {
      if (!trackNames.has(name)) {
        console.warn(`[WARN] order.json entry has no matching track: "${name}"`);
      }
    }

    tracks.sort((a, b) => {
      const posA = positionMap.get(a.name);
      const posB = positionMap.get(b.name);
      if (posA !== undefined && posB !== undefined) return posA - posB;
      if (posA !== undefined) return -1;
      if (posB !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });

    console.log(`[MUSIC] Applied custom order (${customOrder.length} entries)`);
  } else {
    tracks.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[MUSIC] No order.json found — using alphabetical order`);
  }

  return tracks;
}

// ─── Cooldown Formatting ─────────────────────────────────────────────
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}