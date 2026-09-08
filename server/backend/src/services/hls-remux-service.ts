import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Server-side HLS remux sessions (ffmpeg) — SHARED per upstream stream.
 *
 * Raw MPEG-TS upstreams cannot be played by browsers on HTTPS pages directly
 * (the provider media CDN is http:// only → mixed content, and hls.js cannot
 * parse a raw TS pipe). This service remuxes the upstream TS into a live HLS
 * (fMP4) window with ffmpeg (`-c copy`, no transcoding) and serves the
 * playlist + segments over HTTPS same-origin, so the web player uses hls.js.
 *
 * SHARING (D1 — segment/capacity scaling):
 *   One ffmpeg process per UPSTREAM STREAM, not per viewer. Every playback
 *   token that resolves to the same upstream URL joins the same session and
 *   serves the same on-disk playlist/segments. 100 viewers on one channel =
 *   ONE upstream fetch (one stream through the operator's home relay, one
 *   provider connection), the rest is local disk reads. Viewers keep their
 *   own token/session entries (per-request auth in the route is unchanged),
 *   so sharing is purely a media-fetch optimization.
 *
 * Lifecycle:
 *  - A session starts lazily on the first viewer's request; later viewers of
 *    the same stream join it instead of spawning another ffmpeg.
 *  - Segment/playlist requests refresh each viewer's lastAccess; an idle
 *    sweep (30s) drops viewers untouched for HLS_IDLE_MS (default 90s) and
 *    only kills the ffmpeg process when the LAST viewer of a stream leaves.
 *  - Process exit (upstream died / ffmpeg error) tears the whole stream
 *    session down; the next viewer request restarts it.
 *  - MAX_HLS_REMUX caps concurrent ffmpeg PROCESSES (= concurrent streams),
 *    which is exactly what scales: 100 viewers of one stream cost 1 slot.
 */

interface HlsSession {
  token: string;
  proc: ChildProcess;
  dir: string;
  startedAt: number;
  lastAccess: number;
  streamKey: string;
}

const sessions = new Map<string, HlsSession>();
const streamMembers = new Map<string, Set<string>>();

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

function isRunning(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null && !proc.killed;
}

function streamKeyFor(streamUrl: string, headers?: { userAgent?: string; referrer?: string }): string {
  // The same channel resolves to the same upstream URL (channel.channelUrl) —
  // viewer identity is NOT part of the key, so all viewers share the fetch.
  return `${streamUrl}|${headers?.userAgent || ''}|${headers?.referrer || ''}`;
}

function tearDownStream(streamKey: string, dir: string): void {
  const members = streamMembers.get(streamKey);
  if (members) {
    for (const token of members) {
      sessions.delete(token);
    }
    streamMembers.delete(streamKey);
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
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
  const members = streamMembers.get(s.streamKey);
  members?.delete(token);
  sessions.delete(token);
  // Kill the shared ffmpeg only when this was the LAST viewer of the stream.
  if (!members || members.size === 0) {
    streamMembers.delete(s.streamKey);
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

  const streamKey = streamKeyFor(opts.streamUrl, opts.upstreamHeaders);

  // 1) Join an already-running session for the SAME upstream stream.
  const members = streamMembers.get(streamKey);
  if (members && members.size > 0) {
    let live: HlsSession | null = null;
    for (const memberToken of members) {
      const member = sessions.get(memberToken);
      if (member && isRunning(member.proc)) {
        live = member;
        break;
      }
    }
    if (live) {
      sessions.set(token, {
        token,
        proc: live.proc,
        dir: live.dir,
        startedAt: Date.now(),
        lastAccess: Date.now(),
        streamKey,
      });
      members.add(token);
      return { ok: true };
    }
    // Stale members (proc exited, cleanup pending/racing) — drop them and
    // start a fresh process below.
    streamMembers.delete(streamKey);
    for (const memberToken of Array.from(members)) {
      sessions.delete(memberToken);
    }
  }

  // 2) Capacity: MAX_HLS_REMUX counts concurrent ffmpeg PROCESSES (= streams).
  if (streamMembers.size >= MAX_CONCURRENT) {
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
  // Optional egress proxy: IPTV providers commonly WAF-block datacenter IPs on
  // stream endpoints (HTTP 456/458). Pointing UPSTREAM_HTTP_PROXY at a
  // residential/ISP proxy lets the remux fetch the upstream from an allowed IP.
  const upstreamProxy = String(process.env.UPSTREAM_HTTP_PROXY || '').trim();
  if (upstreamProxy) {
    args.push('-http_proxy', upstreamProxy);
    args.push('-https_proxy', upstreamProxy);
  }
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
    streamKey,
  };
  sessions.set(token, session);
  const memberSet = new Set<string>([token]);
  streamMembers.set(streamKey, memberSet);

  proc.on('exit', (code, signal) => {
    // Any viewer can hit this: tear down the whole stream session.
    tearDownStream(streamKey, dir);
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
