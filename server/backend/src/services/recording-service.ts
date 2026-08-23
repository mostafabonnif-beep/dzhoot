/**
 * Recording service — record live HLS/TS streams to disk with ffmpeg and
 * finalize them into downloadable MP4 files (like YouTube Live VODs).
 *
 * - Recording runs INSIDE the API container: outbound traffic to upstream
 *   hosts that block datacenter IPs (e.g. Business Cloud NEO) is transparently
 *   redirected through the home relay (redsocks + iptables) exactly like the
 *   playback proxy, so a recording of those channels works while the relay is up.
 * - Streams are captured with `-c copy` (no re-encode → low CPU), containerized
 *   as MPEG-TS during capture (survives live hiccups), then remuxed to MP4
 *   (+faststart) on stop so browsers can play/download it.
 */
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import Recording from '../models/Recording';
import Channel from '../models/Channel';

const statAsync = promisify(fs.stat);
const unlinkAsync = promisify(fs.unlink);

function recordingsDir(): string {
  return process.env.RECORDINGS_DIR || '/app/recordings';
}
const MAX_SECONDS = parseInt(process.env.RECORDING_MAX_SECONDS || '43200', 10); // 12h default
const RETENTION_DAYS = parseInt(process.env.RECORDING_RETENTION_DAYS || '30', 10);
const MAX_CONCURRENT = parseInt(process.env.RECORDING_MAX_CONCURRENT || '2', 10);

interface ActiveJob {
  proc: ChildProcess;
  recId: string;
  startedAt: number;
  tsFile: string;
}

const activeJobs = new Map<string, ActiveJob>();

function makeSlug(): string {
  return `rec-${crypto.randomBytes(5).toString('base64url')}`;
}

function safeName(name: string): string {
  return (name || 'channel').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'channel';
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

function runProc(bin: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.length > 4000) out = out.slice(-4000);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
      if (err.length > 4000) err = err.slice(-4000);
    });
    proc.on('close', (code) => resolve({ code, out: out || err }));
    proc.on('error', (e) => resolve({ code: -1, out: e.message }));
  });
}

function runFfmpeg(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return runProc(ffmpegBin(), args).then((r) => ({ code: r.code, stderr: r.out }));
}

async function probeDuration(file: string): Promise<number | null> {
  try {
    const r = await runProc(ffprobeBin(), [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    if (r.code === 0) {
      const dur = parseFloat(r.out.trim());
      return Number.isFinite(dur) ? dur : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Finalize a finished/failed recording: remux TS→MP4, stat size, persist. */
async function finalize(rec: any, forcedStop: boolean): Promise<void> {
  const tsFile = path.join(recordingsDir(), `${rec.slug}.ts`);
  const mp4File = path.join(recordingsDir(), `${rec.slug}.mp4`);
  let ok = false;
  try {
    if (fs.existsSync(tsFile)) {
      const { code } = await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', tsFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        mp4File,
      ]);
      if (code === 0 && fs.existsSync(mp4File)) {
        await unlinkAsync(tsFile).catch(() => {});
        ok = true;
      }
    }
  } catch {
    /* fall through */
  }

  const duration = (await probeDuration(ok ? mp4File : tsFile)) ?? Math.round((Date.now() - rec.startedAt.getTime()) / 1000);
  const sizeFile = ok ? mp4File : tsFile;
  let sizeBytes = 0;
  try {
    const st = await statAsync(sizeFile);
    sizeBytes = st.size;
  } catch {
    /* ignore */
  }

  rec.status = ok ? 'ready' : 'failed';
  if (!ok) rec.error = 'ffmpeg capture/remux failed (check relay/upstream availability)';
  rec.endedAt = new Date();
  rec.durationSec = Math.max(0, Math.round(duration));
  rec.sizeBytes = sizeBytes;
  rec.fileName = ok ? `${rec.slug}.mp4` : `${rec.slug}.ts`;
  await rec.save();
}

export async function startRecording(channelId: string, userId?: string): Promise<{ rec: any; alreadyActive?: boolean }> {
  const channel = await Channel.findOne({ ownerId: null, channelId }).lean();
  if (!channel || !channel.channelUrl) {
    const err: any = new Error('Channel not found or has no stream URL');
    err.status = 404;
    throw err;
  }
  if (activeJobs.size >= MAX_CONCURRENT) {
    const err: any = new Error(`Maximum concurrent recordings reached (${MAX_CONCURRENT})`);
    err.status = 429;
    throw err;
  }
  const existing = await Recording.findOne({ channelId, status: 'recording' }).lean();
  if (existing) return { rec: existing, alreadyActive: true };

  const slug = makeSlug();
  const validUserId = /^[0-9a-fA-F]{24}$/.test(String(userId || '')) ? userId : null;
  const rec = await Recording.create({
    channelId,
    channelName: String(channel.channelName || channel.channelId),
    channelGroup: String(channel.channelGroup || ''),
    slug,
    status: 'recording',
    startedAt: new Date(),
    createdBy: validUserId,
  });

  const tsFile = path.join(recordingsDir(), `${slug}.ts`);
  fs.mkdirSync(recordingsDir(), { recursive: true });

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', channel.channelUrl,
    '-c', 'copy',
    '-f', 'mpegts',
    '-t', String(MAX_SECONDS),
    tsFile,
  ];
  const proc = spawn(ffmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  activeJobs.set(String(rec._id), { proc, recId: String(rec._id), startedAt: Date.now(), tsFile });

  proc.on('close', async (code) => {
    activeJobs.delete(String(rec._id));
    const fresh = await Recording.findById(rec._id).exec();
    if (!fresh) return;
    // The capture may exit non-zero on a user-initiated stop (SIGTERM commonly
    // yields 255 while flushing). What matters is whether it produced data.
    const hasData = fs.existsSync(tsFile) && fs.statSync(tsFile).size > 0;
    if (hasData) {
      await finalize(fresh, false);
    } else {
      fresh.status = 'failed';
      fresh.error = `ffmpeg exited with code ${code}: ${stderr.slice(-300)}`;
      fresh.endedAt = new Date();
      await fresh.save();
    }
  });
  proc.on('error', async (err) => {
    activeJobs.delete(String(rec._id));
    const fresh = await Recording.findById(rec._id).exec();
    if (!fresh) return;
    const hasData = fs.existsSync(tsFile) && fs.statSync(tsFile).size > 0;
    if (hasData) {
      await finalize(fresh, false);
    } else {
      fresh.status = 'failed';
      fresh.error = `failed to spawn ffmpeg: ${err.message}`;
      fresh.endedAt = new Date();
      await fresh.save();
    }
  });

  return { rec };
}

export async function stopRecording(id: string): Promise<any> {
  const job = activeJobs.get(id);
  if (job) {
    job.proc.kill('SIGTERM');
    // ffmpeg will flush and exit; finalize happens in the 'close' handler.
  }
  const rec = await Recording.findById(id).exec();
  if (!rec) {
    const err: any = new Error('Recording not found');
    err.status = 404;
    throw err;
  }
  return rec;
}

export async function deleteRecording(id: string): Promise<void> {
  const job = activeJobs.get(id);
  if (job) job.proc.kill('SIGKILL');
  activeJobs.delete(id);
  const rec = await Recording.findById(id).exec();
  if (rec) {
    for (const ext of ['mp4', 'ts']) {
      const f = path.join(recordingsDir(), `${rec.slug}.${ext}`);
      await unlinkAsync(f).catch(() => {});
    }
    await rec.deleteOne();
  }
}

export function recordingFilePath(slug: string, fileName?: string): string {
  const name = fileName || `${slug}.mp4`;
  return path.join(recordingsDir(), path.basename(name));
}

export async function listRecordings(filter: Record<string, unknown> = {}, page = 1, pageSize = 50) {
  // Lazy cleanup of expired recordings (retention)
  await cleanupExpiredRecordings();
  const [totalCount, data] = await Promise.all([
    Recording.countDocuments(filter),
    Recording.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  return { totalCount, data };
}

export async function getRecordingStats() {
  const [active, total, totalSize] = await Promise.all([
    Recording.countDocuments({ status: 'recording' }),
    Recording.countDocuments({}),
    Recording.aggregate([{ $group: { _id: null, size: { $sum: { $ifNull: ['$sizeBytes', 0] } } } }]),
  ]);
  return { active, total, totalSizeBytes: totalSize[0]?.size || 0 };
}

async function cleanupExpiredRecordings(): Promise<number> {
  if (!RETENTION_DAYS || RETENTION_DAYS <= 0) return 0;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const expired = await Recording.find({ startedAt: { $lt: cutoff } }).lean();
  let removed = 0;
  for (const rec of expired) {
    await deleteRecording(String(rec._id));
    removed++;
  }
  return removed;
}

export { safeName };
