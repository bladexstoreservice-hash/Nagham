import { ActivityType, Client } from 'discord.js';
import {
  STATUS_INTERVAL,
  VOICE_CHANNEL_ID,
  STATUS_TIMEZONE,
  TIME_PERIODS,
  MORNING_STATUSES,
  NEUTRAL_STATUSES,
  SUNSET_STATUSES,
  NIGHT_STATUSES,
} from './config.js';

const lastPickedIndex: Record<string, number> = {
  MORNING: -1,
  NEUTRAL: -1,
  SUNSET: -1,
  NIGHT: -1,
};

export type TimePeriod = 'MORNING' | 'NEUTRAL' | 'SUNSET' | 'NIGHT';

// ─── Get current hour in Germany ─────────────────────────────────────
function getGermanHour(): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: STATUS_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(new Date());
  return parseInt(formatted, 10);
}

export function getCurrentPeriod(): TimePeriod {
  const hour = getGermanHour();

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

function getStatusesForPeriod(period: TimePeriod): string[] {
  switch (period) {
    case 'MORNING': return MORNING_STATUSES;
    case 'NEUTRAL': return NEUTRAL_STATUSES;
    case 'SUNSET':  return SUNSET_STATUSES;
    case 'NIGHT':   return NIGHT_STATUSES;
  }
}

function pickRandomStatus(): { text: string; period: TimePeriod } {
  const period = getCurrentPeriod();
  const pool = getStatusesForPeriod(period);

  if (pool.length === 0) return { text: '🎵 24/7 Music', period };
  if (pool.length === 1) return { text: pool[0]!, period };

  let index: number;
  do {
    index = Math.floor(Math.random() * pool.length);
  } while (index === lastPickedIndex[period]);

  lastPickedIndex[period] = index;
  return { text: pool[index]!, period };
}

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

async function setVoiceChannelStatus(client: Client, statusText: string): Promise<void> {
  try {
    await client.rest.put(`/channels/${VOICE_CHANNEL_ID}/voice-status`, {
      body: { status: statusText },
    });
  } catch (err) {
    console.warn(`[WARN] Failed to set VC status: ${err}`);
  }
}

async function applyStatus(client: Client): Promise<void> {
  const { text, period } = pickRandomStatus();
  const hour = getGermanHour();
  setPresence(client, text);
  await setVoiceChannelStatus(client, text);
  console.log(`[STATUS] [${period} · ${hour}:00 DE] → ${text}`);
}

export function startStatusTimer(client: Client): void {
  void applyStatus(client);

  setInterval(() => {
    void applyStatus(client);
  }, STATUS_INTERVAL);

  console.log(
    `[STATUS] Dynamic timer started (every ${STATUS_INTERVAL / 60000} min · timezone: ${STATUS_TIMEZONE})`,
  );
}