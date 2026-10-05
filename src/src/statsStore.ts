import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';

const STATS_FILE = path.join(PROJECT_ROOT, 'stats.json');

type StatsEntry = {
  totalTimeMs: number;
  lastJoinAt?: number;
  lastLeaveAt?: number;
};

let stats: Record<string, StatsEntry> = {};
let saveTimer: NodeJS.Timeout | null = null;

// ─── Load ────────────────────────────────────────────────────────────
export function loadStats(): void {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        stats = parsed as Record<string, StatsEntry>;
      } else {
        stats = {};
      }
      console.log(`[STATS] Loaded ${Object.keys(stats).length} entries`);
    } else {
      stats = {};
      console.log('[STATS] No stats.json — starting fresh');
    }
  } catch (err) {
    console.warn(`[WARN] Failed to load stats: ${err}`);
    stats = {};
  }
}

// ─── Save ────────────────────────────────────────────────────────────
export function saveStats(): void {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[ERROR] Failed to save stats: ${err}`);
  }
}

// Debounced save (max 1 write per 5 seconds)
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStats();
  }, 5000);
}

// ─── Join / Leave ────────────────────────────────────────────────────
export function recordUserJoin(userId: string): void {
  const entry = stats[userId] ?? { totalTimeMs: 0 };
  entry.lastJoinAt = Date.now();
  stats[userId] = entry;
  scheduleSave();
  console.log(
    `[STATS] ${userId} joined (total: ${Math.round(entry.totalTimeMs / 1000)}s)`,
  );
}

export function recordUserLeave(userId: string): void {
  const entry = stats[userId];
  if (!entry || !entry.lastJoinAt) return;

  const sessionMs = Date.now() - entry.lastJoinAt;
  entry.totalTimeMs += sessionMs;
  entry.lastJoinAt = undefined;
  entry.lastLeaveAt = Date.now();
  stats[userId] = entry;
  saveStats(); // immediate save on leave
  console.log(
    `[STATS] ${userId} left (+${Math.round(sessionMs / 1000)}s, total: ${Math.round(entry.totalTimeMs / 1000)}s)`,
  );
}

// ─── Query ───────────────────────────────────────────────────────────
export function getUserTotalMs(userId: string): number {
  const entry = stats[userId];
  if (!entry) return 0;
  const accumulated = entry.totalTimeMs;
  const live = entry.lastJoinAt ? Date.now() - entry.lastJoinAt : 0;
  return accumulated + live;
}

export function getUserIsInChannel(userId: string): boolean {
  const entry = stats[userId];
  return !!(entry && entry.lastJoinAt);
}

export function getAllStats(): Record<string, StatsEntry> {
  return { ...stats };
}