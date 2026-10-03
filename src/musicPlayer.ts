import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import type { Track } from './config.js';
import { getRandomTrack } from './utils.js';

// ─── FFmpeg Path ─────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string | null;

// ─── State ───────────────────────────────────────────────────────────
let connection: VoiceConnection | null = null;
let player: AudioPlayer | null = null;
let currentTrack: Track | null = null;
let trackStartTime = 0;
let pausedAt = 0;
let currentTracks: Track[] = [];
let currentResource: AudioResource | null = null;
let currentFfmpeg: ChildProcessByStdio<null, Readable, null> | null = null;
let currentVolume = 100;
let onTrackChange: (() => void) | null = null;
let onTrackEnd: (() => void) | null = null;

// ─── Getters ─────────────────────────────────────────────────────────
export function getCurrentTrack(): Track | null {
  return currentTrack;
}

export function getElapsed(): number {
  if (!currentTrack || trackStartTime === 0) return 0;
  if (pausedAt > 0) return (pausedAt - trackStartTime) / 1000;
  return (Date.now() - trackStartTime) / 1000;
}

export function getDuration(): number {
  return currentTrack?.duration ?? 0;
}

export function isPlaying(): boolean {
  return player !== null && player.state.status === AudioPlayerStatus.Playing;
}

export function isPaused(): boolean {
  return player !== null && player.state.status === AudioPlayerStatus.Paused;
}

export function getVolume(): number {
  return currentVolume;
}

// ─── Volume ──────────────────────────────────────────────────────────
// NOTE: With OggOpus, Discord does not support inline volume.
// Volume is applied via FFmpeg's `volume` filter on the next track start.
export function setVolume(level: number): number {
  currentVolume = Math.max(1, Math.min(200, Math.round(level)));
  if (currentResource?.volume) {
    currentResource.volume.setVolume(currentVolume / 100);
  }
  return currentVolume;
}

// ─── Pause / Resume ──────────────────────────────────────────────────
export function pause(): boolean {
  if (!player || player.state.status !== AudioPlayerStatus.Playing) return false;
  player.pause();
  pausedAt = Date.now();
  return true;
}

export function resume(): boolean {
  if (!player || player.state.status !== AudioPlayerStatus.Paused) return false;
  if (pausedAt > 0 && trackStartTime > 0) {
    trackStartTime += Date.now() - pausedAt;
    pausedAt = 0;
  }
  player.unpause();
  return true;
}

// ─── Skip ────────────────────────────────────────────────────────────
export function skip(): void {
  if (player) player.stop();
}

// ─── Stop ────────────────────────────────────────────────────────────
export function stopPlayback(): void {
  if (player) player.stop();
  currentTrack = null;
  trackStartTime = 0;
  pausedAt = 0;
  if (onTrackChange) onTrackChange();
}

// ─── Callbacks ───────────────────────────────────────────────────────
export function setOnTrackChange(cb: () => void): void {
  onTrackChange = cb;
}

export function setOnTrackEnd(cb: () => void): void {
  onTrackEnd = cb;
}

// ─── Kill Old FFmpeg Process ─────────────────────────────────────────
function killCurrentFfmpeg(): void {
  if (currentFfmpeg && !currentFfmpeg.killed) {
    try {
      currentFfmpeg.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
  currentFfmpeg = null;
}

// ─── Join Voice Channel ──────────────────────────────────────────────
export async function joinVoice(
  guild: Guild,
  channel: VoiceBasedChannel,
  tracks: Track[],
): Promise<void> {
  currentTracks = tracks;

  if (connection) {
    try {
      connection.destroy();
    } catch {
      // ignore
    }
    connection = null;
  }

  player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
    },
  });

  player.on(AudioPlayerStatus.Idle, () => {
    killCurrentFfmpeg();
    if (onTrackEnd) onTrackEnd();
    if (currentTracks.length > 0) {
      const next = getRandomTrack(currentTracks, currentTrack);
      playTrack(next);
    }
  });

  player.on('error', (error) => {
    console.error(`[ERROR] Player error: ${error.message}`);
    killCurrentFfmpeg();
    if (currentTracks.length > 0) {
      const next = getRandomTrack(currentTracks, currentTrack);
      setTimeout(() => playTrack(next), 500);
    }
  });

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  connection.subscribe(player);

  connection.on('stateChange', (oldState, newState) => {
    console.log(`[VOICE] State: ${oldState.status} → ${newState.status}`);
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log(`[VOICE] Connection Ready`);
    if (!currentTrack && currentTracks.length > 0) {
      const first = getRandomTrack(currentTracks);
      playTrack(first);
    }
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection!, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection!, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      console.warn('[VOICE] Disconnected, attempting to rejoin...');
      try {
        connection?.destroy();
        connection = null;
        await joinVoice(guild, channel, currentTracks);
      } catch (err) {
        console.error(`[ERROR] Failed to rejoin voice: ${err}`);
      }
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn('[VOICE] Connection destroyed');
    killCurrentFfmpeg();
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    console.log(`[VOICE] Connected to ${channel.name}`);
  } catch {
    console.warn(
      `[VOICE] Ready timeout. Current state: ${connection.state.status}.`,
    );
  }
}

// ─── Play Track (High-Quality OggOpus) ───────────────────────────────
// FFmpeg encodes directly to Opus — no PCM intermediate.
// This gives much better audio quality on mobile devices.
export function playTrack(track: Track): void {
  if (!player) {
    console.warn('[WARN] Player not initialized');
    return;
  }

  if (!ffmpegPath) {
    console.error('[ERROR] ffmpeg-static not available');
    return;
  }

  try {
    // Clean up old process & resource
    killCurrentFfmpeg();
    currentResource = null;

    currentTrack = track;
    trackStartTime = Date.now();
    pausedAt = 0;

    // Build FFmpeg args — encode directly to Opus
    const ffmpegArgs: string[] = [
      '-i', track.audioPath,
      '-analyzeduration', '0',
      '-loglevel', '0',

      // ─── Volume (applied via filter) ─────────────────────────────
      '-af', `volume=${currentVolume / 100}`,

      // ─── Opus encoding ───────────────────────────────────────────
      '-acodec', 'libopus',
      '-f', 'opus',
      '-ar', '48000',                // standard Opus sample rate
      '-ac', '2',                    // stereo
      '-b:a', '256k',                // 256 kbps bitrate (max quality)
      '-application', 'audio',       // optimize for music
      '-frame_duration', '20',       // 20 ms frames (Discord standard)
      '-vbr', 'on',                  // variable bitrate
      '-compression_level', '10',    // maximum Opus quality

      'pipe:1',
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    currentFfmpeg = ffmpegProcess;

    ffmpegProcess.on('error', (err) => {
      console.error(`[ERROR] FFmpeg error: ${err.message}`);
    });

    if (!ffmpegProcess.stdout) {
      console.error('[ERROR] FFmpeg stdout is null');
      return;
    }

    currentResource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: false,
      metadata: { title: track.name },
    });

    player.play(currentResource);
    console.log(`[MUSIC] Now playing: ${track.name}`);

    if (onTrackChange) onTrackChange();
  } catch (err) {
    console.error(`[ERROR] Failed to play "${track.name}": ${err}`);
    killCurrentFfmpeg();
    if (currentTracks.length > 0) {
      const next = getRandomTrack(currentTracks, track);
      setTimeout(() => playTrack(next), 1000);
    }
  }
}

// ─── Update Tracks ───────────────────────────────────────────────────
export function updateTracks(tracks: Track[]): void {
  currentTracks = tracks;
}