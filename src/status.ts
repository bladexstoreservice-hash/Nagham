import { ActivityType, Client } from 'discord.js';
import {
  STATUS_INTERVAL,
  VOICE_CHANNEL_ID,
  TIME_PERIODS,
  MORNING_STATUSES,
  NEUTRAL_STATUSES,
  SUNSET_STATUSES,
  NIGHT_STATUSES,
} from './config.js';

// ─── Track last picked per period to avoid immediate repeats ─────────
const lastPickedIndex: Record<string, number> = {
  MORNING: -1,
  NEUTRAL: -1,
  SUNSET: -1,
  NIGHT: -1,
};

// ─── Detect current time period ──────────────────────────────────────
export type TimePeriod = 'MORNING' | 'NEUTRAL' | 'SUNSET' | 'NIGHT';

export function getCurrentPeriod(): TimePeriod {
  const hour = new Date().getHours();

  // Night wraps around midnight (20:00 → 04:59)
  if (hour >= TIME_PERIODS.NIGHT.start || hour < TIME_PERIODS.NIGHT.end) {
    return 'NIGHT';
  }
  if (hour >= TIME_PERIODS.MORNING.start && hour < TIME_PERIODS.MORNING.end) {
    return 'MORNING';
  }
  if (hour >= TIME_PERIODS.SUNSET.start && hour < TIME_PERIODS.SUNSET.end) {
    return 'SUNSET';
  }
  return 'NEUTRAL';
}

// ─── Get statuses list for the current period ────────────────────────
function getStatusesForPeriod(period: TimePeriod): string[] {
  switch (period) {
    case 'MORNING': return MORNING_STATUSES;
    case 'NEUTRAL': return NEUTRAL_STATUSES;
    case 'SUNSET':  return SUNSET_STATUSES;
    case 'NIGHT':   return NIGHT_STATUSES;
  }
}

// ─── Pick a random status within the current period ──────────────────
function pickRandomStatus(): { text: string; period: TimePeriod } {
  const period = getCurrentPeriod();
  const pool = getStatusesForPeriod(period);

  if (pool.length === 0) {
    return { text: '🎵 24/7 Music', period };
  }
  if (pool.length === 1) {
    return { text: pool[0]!, period };
  }

  let index: number;
  do {
    index = Math.floor(Math.random() * pool.length);
  } while (index === lastPickedIndex[period]);

  lastPickedIndex[period] = index;
  return { text: pool[index]!, period };
}

// ─── Set Bot Presence ────────────────────────────────────────────────
function setPresence(client: Client, statusText: string): void {
  try {
    client.user?.setPresence({
      activities: [{ name: statusText, type: ActivityType.Listening }],
      status: 'online',
    });
  } catch (err) {
    console.warn(`[WARN] Failed to set presence: ${err}`);
  }
}

// ─── Try Set Voice Channel Status ────────────────────────────────────
async function setVoiceChannelStatus(client: Client, statusText: string): Promise<void> {
  try {
    await client.rest.put(`/channels/${VOICE_CHANNEL_ID}/voice-status`, {
      body: { status: statusText },
    });
  } catch (err) {
    console.warn(`[WARN] Failed to set voice channel status: ${err}`);
  }
}

// ─── Apply Status ────────────────────────────────────────────────────
async function applyStatus(client: Client): Promise<void> {
  const { text, period } = pickRandomStatus();
  setPresence(client, text);
  await setVoiceChannelStatus(client, text);
  console.log(`[STATUS] [${period}] → ${text}`);
}

// ─── Start Timer ─────────────────────────────────────────────────────
export function startStatusTimer(client: Client): void {
  // Initial
  void applyStatus(client);

  // Every 30 min
  setInterval(() => {
    void applyStatus(client);
  }, STATUS_INTERVAL);

  console.log(`[STATUS] Dynamic status timer started (every ${STATUS_INTERVAL / 60000} min)`);
}