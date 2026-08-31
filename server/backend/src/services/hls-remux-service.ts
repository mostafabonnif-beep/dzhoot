import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Server-side HLS remux sessions (ffmpeg).
 *
 * Raw MPEG-TS upstreams cannot be played by browsers on HTTPS pages directly
 * (the provider media CDN is http:// only → mixed content, and hls.js cannot
 * parse a raw TS pipe). This service remuxes the upstream TS into a live HLS
 * (fMP4) window with ffmpeg (`-c copy`, no transcoding) and serves the
 * playlist + segments over HTTPS same-origin, so the web player uses hls.js —
 * the most robust live player available.
 *
 * Lifecycle:
 *  - One ffmpeg process per playback token, lazily started on first request.
 *  - Segment/playlist requests refresh lastAccess; an idle sweep (30s) kills
 *    sessions untouched for HLS_IDLE_MS (default 90s).
 *  - Process exit (upstream died / ffmpeg error) deletes the session so the
 *    next request restarts it (the player falls back meanwhile).
 *  - MAX_HLS_REMUX caps concurrent processes (2-core VPS).
 */

interface HlsSession {
  token: string;
  proc: ChildProcess;
  dir: string;
  startedAt: number;
  lastAccess: number;
}

const sessions = new Map<string, HlsSession>();

const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_HLS_REMUX || 6));
const IDLE_MS = Math.max(30_000, Number(process.env.HLS_IDLE_MS || 90_000));
const SWEEP_INTERVAL_MS = 30_000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function baseDir(): string {
  return path.join(os.tmpdir(), 'dzhoot-hls');
}

function safeTokenName(token: string): string {
  return token.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
}

export function getHlsSessionDir(token: string): string {
  return path.join(baseDir(), safeTokenName(token));
}

export function getHlsSession(token: string): HlsSession | null {
  return sessions.get(token) || null;
}

export function touchHlsSession(token: string): void {
  const s = sessions.get(token);
  if (s) s.lastAccess = Date.now();
}

export function stopHlsSession(token: string): void {
  const s = sessions.get(token);
  if (!s) return;
  sessions.delete(token);
  try {
    s.proc.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  try {
    fs.rmSync(s.dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export interface StartHlsOptions {
  streamUrl: string;
  upstreamHeaders?: { userAgent?: string; referrer?: string };
}

export function startHlsSession(
  token: string,
  opts: StartHlsOptions,
): { ok: true } | { ok: false; error?: string; busy?: boolean } {
  const existing = sessions.get(token);
  if (existing) {
    existing.lastAccess = Date.now();
    return { ok: true };
  }
  if (sessions.size >= MAX_CONCURRENT) {
    return { ok: false, busy: true };
  }

  const dir = getHlsSessionDir(token);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `mkdir failed: ${String(e)}` };
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
  ];
  if (opts.upstreamHeaders?.userAgent) {
    args.push('-user_agent', opts.upstreamHeaders.userAgent);
  }
  if (opts.upstreamHeaders?.referrer) {
    args.push('-headers', `Referer: ${opts.upstreamHeaders.referrer}\r\n`);
  }
  // Live-friendly HTTP input: reconnect on network blips, 15s socket timeout.
  args.push(
    '-rw_timeout', '15000000',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', opts.streamUrl,
    // Remux (copy) only the video + best audio; drop everything else.
    // aac_adtstoasc: upstream ADTS AAC must be converted for MP4/fMP4 muxing.
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(dir, 'seg_%d.m4s'),
    path.join(dir, 'index.m3u8'),
  );

  let proc: ChildProcess;
  try {
    proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    return { ok: false, error: `spawn failed: ${String(e)}` };
  }

  // Keep stderr for debugging but never let it fill a pipe.
  const stderrChunks: string[] = [];
  proc.stderr?.on('data', (d: Buffer) => {
    stderrChunks.push(d.toString('utf8'));
    if (stderrChunks.length > 20) stderrChunks.shift();
  });

  const session: HlsSession = {
    token,
    proc,
    dir,
    startedAt: Date.now(),
    lastAccess: Date.now(),
  };
  sessions.set(token, session);

  proc.on('exit', (code, signal) => {
    if (sessions.get(token) === session) {
      sessions.delete(token);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    if (code !== 0 && code !== null) {
      console.error(
        `[hls-remux] ffmpeg exited code=${code} signal=${signal ?? ''} token=${token.slice(0, 8)}… stderr=${stderrChunks.join(' ').slice(0, 500)}`,
      );
    }
  });

  ensureSweep();
  return { ok: true };
}

function sweep(): void {
  const now = Date.now();
  for (const [token, s] of Array.from(sessions.entries())) {
    if (now - s.lastAccess > IDLE_MS) {
      stopHlsSession(token);
    }
  }
}

function ensureSweep(): void {
  if (!sweepTimer) {
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
  }
}

/** Stop everything (container shutdown hook if ever needed). */
export function shutdownHlsSessions(): void {
  for (const token of Array.from(sessions.keys())) {
    stopHlsSession(token);
  }
}
